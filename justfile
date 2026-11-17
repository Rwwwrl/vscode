import? 'justfile.local'

# Run every recipe with the Node.js pinned in .nvmrc. `pnpm install` refuses another major
# (build/npm/preinstall.ts) and build-fast keys its incremental state on the exact Node version,
# so a shell without the fnm hook (IDE tasks, agents, cron) must not fall back to Homebrew's node.
export PATH := `d="$(fnm exec --using=.nvmrc -- node -p 'require("path").dirname(process.execPath)' 2>/dev/null)" && printf '%s:' "$d" || true` + env('PATH')

# List the recipes
default:
    @just --list


# Build the dev app from sources (client, built-in extensions, Copilot, Electron); incremental
[group('build')]
build-dev:
    pnpm run build-fast
    node build/lib/preLaunch.ts

# Package the minified, locally signed app and its .dmg into .build/vsade/, then install it (`just install`)
[group('build')]
build: && install
    #!/usr/bin/env bash
    set -euo pipefail
    arch="$(node -p process.arch)"
    name="$(node -p "require('./product.json').nameLong")"
    # The install that follows refuses to replace a running app: say so now, not after the build.
    if pgrep -f "/Applications/$name.app/Contents/MacOS/" > /dev/null; then
        echo "Quit $name before building: the build installs it into /Applications" >&2
        exit 1
    fi
    version="$(node -p "require('./package.json').version")"
    out=.build/vsade
    started=$SECONDS
    node build/lib/builtInExtensions.ts
    # Bundles and packages the app into ../VSCode-darwin-<arch>, a sibling of the repo; move it in.
    pnpm run gulp "vscode-darwin-$arch-min"
    rm -rf "$out/VSCode-darwin-$arch"
    mkdir -p "$out"
    mv "../VSCode-darwin-$arch" "$out/"
    app="$out/VSCode-darwin-$arch/$name.app"
    # Packaging rewrites Info.plist and renames Electron's linker-signed bundle, so its seal no longer
    # verifies. Re-sign it with the local self-signed certificate (created on first use, not a
    # Developer ID): unlike an ad-hoc signature it is the same on every build, so macOS remembers
    # keychain permissions granted to the app.
    ./scripts/vsade/sign-app.sh "$app"
    dmg="$out/$name-$version-darwin-$arch.dmg"
    # On first use, installs dmgbuild the way build/darwin/create-dmg.ts does: a clone at the pinned
    # commit with a venv in the git-ignored build/darwin/.dmgbuild (needs python3 >= 3.10).
    ./scripts/vsade/create-dmg.sh "$app" "$dmg"
    echo "Built in $((SECONDS - started))s"
    echo "App: $PWD/$app"
    echo "DMG: $PWD/$dmg"

# Delete the build outputs: out/, extension outputs, .build/ (Electron, packaged app, dmg)
[group('build')]
clean:
    git clean -fdX -- out .build extensions/*/out extensions/*/dist


# Run the dev app from sources, rebuilding only what changed since the last build-dev
[group('run')]
[positional-arguments]
run-dev *args: build-dev
    VSCODE_SKIP_PRELAUNCH=1 ./scripts/code.sh "$@"

# Copy the packaged app from `just build` (which runs this) into /Applications and link its command line launcher into ~/.local/bin
[group('run')]
install:
    #!/usr/bin/env bash
    set -euo pipefail
    name="$(node -p "require('./product.json').nameLong")"
    app=".build/vsade/VSCode-darwin-$(node -p process.arch)/$name.app"
    cli="$(node -p "require('./product.json').applicationName")"
    bin="${VSADE_BIN_DIR:-$HOME/.local/bin}"
    test -d "$app" || { echo "Run 'just build' first: $app is missing" >&2; exit 1; }
    if pgrep -f "/Applications/$name.app/Contents/MacOS/" > /dev/null; then
        echo "Quit $name before installing a new build" >&2
        exit 1
    fi
    rm -rf "/Applications/$name.app"
    ditto "$app" "/Applications/$name.app"
    # The packaged bundle is dated 1980, so macOS keeps showing the icon it cached for the previous install.
    # A fresh date and a forced registration make Finder and the Dock read the new icon.
    touch "/Applications/$name.app"
    /System/Library/Frameworks/CoreServices.framework/Frameworks/LaunchServices.framework/Support/lsregister -f "/Applications/$name.app"
    # The launcher script resolves symlinks back to the app, like upstream's "Install 'code' command in PATH".
    mkdir -p "$bin"
    ln -sf "/Applications/$name.app/Contents/Resources/app/bin/code" "$bin/$cli"
    echo "Installed /Applications/$name.app and the '$cli' command in $bin"
    case ":$PATH:" in *":$bin:"*) ;; *) echo "Note: $bin is not on PATH; add it to use '$cli .'" ;; esac

# Sync the vsade profile (scripts/vsade/sync-profile.sh)
[group('run')]
sync-profile target='all':
    ./scripts/vsade/sync-profile.sh {{target}}


# Type-check the sources under src/
[group('check')]
typecheck:
    pnpm run typecheck-client

# Run unit tests, e.g. `just test --grep Strings` or `just test --run <file>.test.ts`
[group('check')]
[positional-arguments]
test *args:
    ./scripts/test.sh "$@"

# Lint the given files with oxlint
[group('check')]
[positional-arguments]
lint *files:
    pnpm run oxlint "$@"

# Run the repo hygiene checks on the given files (default: the staged files)
[group('check')]
[positional-arguments]
hygiene *files:
    pnpm run precommit "$@"

# List upstream-owned files modified by the fork and flag missing FORK markers
[group('check')]
fork-patches:
    ./scripts/vsade/fork-patches.sh
