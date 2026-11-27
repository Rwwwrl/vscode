# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What This Repository Is

**vsade** is a personal fork of [microsoft/vscode](https://github.com/microsoft/vscode) that adds features VS Code does not have. It tracks upstream continuously, so the fork is a thin layer on top of a very fast-moving codebase.

Upstream's own agent instructions (`.github/copilot-instructions.md`: architecture, coding guidelines, how to validate TypeScript changes) are loaded next to this file through the `.claude/CLAUDE.md` symlink that `pnpm install` creates. They are not repeated here. This file holds what is specific to the fork, and it wins where the two disagree.

## Rule Zero: Isolate Fork Changes

Upstream lands on the order of a hundred commits a day. Every line the fork changes in an upstream file is a future merge conflict, so:

- **Fork code lives in fork-owned files.** A file is fork-owned when it does not exist on `main`. The roots are `src/vs/workbench/contrib/vsade/`, `extensions/vsade-<feature>/`, `scripts/vsade/`, the fork's skills under `.agents/skills/`, `justfile` and this file.
- **Changing an upstream-owned file is the last resort**, taken only after a setting, an extension, a built-in extension and a fork-owned contribution have each been ruled out. Prefer a one-line seam that calls into fork code over logic inlined in an upstream file.
- **Every hunk in an upstream-owned file is highlighted** by a `FORK: <why>` comment on its own line directly above it. Files that cannot hold comments (JSON, generated files) get a line in `scripts/vsade/fork-patches.txt` instead.
- **`just fork-patches` must pass** before a pull request is opened, and the pull request body lists every upstream-owned file it touches with the reason.
- No drive-by edits in upstream files: no reformatting, renames, import reordering or comment fixes.
- Everything the fork registers (commands, settings, context keys, view ids, storage keys) is prefixed `vsade.`.

Load the `fork-feature` skill **before writing any code** for a feature or behavior change. It has the placement ladder, the folder layout that needs no lint configuration changes, and the list of upstream hotspots to stay out of.

## Branches and Landing Changes

| Ref | Role |
| --- | --- |
| `upstream` | `microsoft/vscode`. Read-only. Never open pull requests, issues or comments there. |
| `origin` | The fork, `Rwwwrl/vscode`. Public. |
| `main` | Exact mirror of `upstream/main`. Never commit to it. |
| `sosov-fork` | The fork's trunk and default branch. Never commit or push to it directly. |

- Work happens on a branch cut from `sosov-fork` (`git-branch` skill) and lands through a pull request that is **squash-merged** (`create-pr` skill, also `/create-pr`).
- `gh` resolves a fork to its parent when it has to guess. Pass `--repo Rwwwrl/vscode --base sosov-fork` on every `gh pr` command.
- Upstream is brought in only by the `sync-upstream` skill, as a real merge commit, and only when asked.
- Commit subjects and pull request titles use `[scope] type context past-tense-description` (`commit` skill). Commit only what the user staged.
- The repository is public. Nothing from the user's private settings, profile or other projects goes into code, commits or pull requests.

## Commands

Dependencies are installed with `pnpm install` (never npm or yarn). The `justfile` runs every recipe with the Node.js version pinned in `.nvmrc`.

| Command | Use |
| --- | --- |
| `just build-dev` | Build the app from sources to try a finished feature. Incremental after the first run. |
| `just run-dev [args]` | Run that build (`scripts/code.sh`); rebuilds only what changed. |
| `just build` | Package the minified app, signed with a local self-signed certificate, and the `.dmg` into `.build/vsade/`, then run `just install`. Fails up front while the installed app runs. Slow; run it only when asked for a release build. |
| `just install` | Copy the packaged app into `/Applications` and link the `ade` command into `~/.local/bin`, so `ade .` works like `code .`. `just build` runs it; on its own it reinstalls the last build. User-invoked only. |
| `just sync-profile [app\|dev\|all]` | Copy settings, keybindings, snippets and extensions from the stock VS Code install into the vsade profiles, then apply `~/.vsade/settings.overrides.json` on top. User-invoked only. |
| `just fork-patches` | List upstream-owned files the fork modifies; fail on changes that are not highlighted. |
| `just lint <files>` | oxlint on the given files. |
| `just hygiene [files]` | Copyright header, tab indentation, formatting and lint checks; without arguments, the staged files. |
| `just test --run <src/…/x.test.ts>` | One unit test file. Add `--grep "<title>"` for one suite or test. Tests run against `out/`, so refresh it first with `pnpm run build-fast --client-only`. |
| `just typecheck` | Type-check `src/`. Expensive; see `validate-change` for when it is warranted. |

There is no git pre-commit hook in this checkout, and upstream's CI does not run for pull requests into `sosov-fork`. Nothing checks a change unless you run the checks: follow the `validate-change` skill before calling work done.

## Skills

Fork skills live in `.agents/skills/` (`.claude/skills` is a symlink to it). Use them instead of improvising:

| Skill | Use for |
| --- | --- |
| `vsade-features` | The fork's existing features (Agent Dock, multibuffer, ...), the names used for them, their parts, ids and files. Read it when a feature is named or past fork work is referenced. |
| `fork-feature` | Deciding where a change goes and how to keep it isolated. First step of any feature. |
| `workbench-contribution` | Implementing a core workbench feature: actions, menus, keybindings, settings, context keys, services, contributions, views. |
| `upstream-guides` | Index of upstream's area-specific rules in `.github/instructions/` and `.github/skills/`, which Claude Code does not load on its own. Read the matching guides before editing an area. |
| `validate-change` | The validation ladder: lint, hygiene, targeted tests, type checks, layering, manual run. |
| `launch` | Driving a running dev build for UI verification and debugging (upstream-owned skill; do not edit it). |
| `git-branch` | Naming and creating a branch from `sosov-fork`. |
| `commit` | Committing staged changes in the fork's subject format. |
| `create-pr` | Pushing the current branch and opening its pull request with `gh` (`/create-pr`). |
| `sync-upstream` | Merging the latest upstream into `sosov-fork`. |

## Product Identity

`product.json` is rebranded: the app and executable are `vsade`, the command line name (`applicationName`) is `ade` (the bundled launcher script keeps upstream's macOS file name, `Contents/Resources/app/bin/code`), the bundle id is `dev.vsade.app`, the URL protocol is `vsade`, and the extension gallery is [Open VSX](https://open-vsx.org).

| Build | User data | Extensions |
| --- | --- | --- |
| Packaged app (`just build`) | `~/Library/Application Support/vsade` | `~/.vsade/extensions` |
| From sources (`just run-dev`) | `~/Library/Application Support/code-oss-dev` (fixed by `src/vs/platform/environment/node/userDataPath.ts`) | `~/.vsade-dev/extensions` |

Consequences worth knowing:

- Extensions that Microsoft licenses only for its own builds (Pylance, Remote - SSH and similar) are not on Open VSX and may refuse to run here.
- Installing from the gallery fails in the packaged app with "Signature verification was not executed": the verifier, `@vscode/vsce-sign`, is not among the open-source dependencies. Installing a downloaded `.vsix` works. Turning `extensions.verifySignature` off is the owner's decision; do not change it on your own.
- Because a gallery is configured, `build/lib/builtInExtensions.ts` resolves the `builtInExtensions` of `product.json` through it rather than through GitHub releases.
- Upstream tooling that hard-codes `Code - OSS` or `~/.vscode-oss-dev` (some `.vscode/launch.json` configurations, the default seed profile of the `launch` skill) does not match this product; pass paths explicitly instead of editing those files.
