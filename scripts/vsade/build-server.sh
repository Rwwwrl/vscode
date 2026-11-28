#!/usr/bin/env bash
# Builds the vsade server for Linux (the remote host of Open Remote - SSH) from the current checkout into
# .build/vsade/vsade-server-linux-<arch>-<commit>.tar.gz. The extension copies it to a host on the first connect
# when remote.SSH.serverDownloadUrlTemplate points at it with remote.SSH.localServerDownload "always".
#
#   scripts/vsade/build-server.sh <arch>     arch: arm64 or x64
#
# gulp packages the server on macOS with the Linux Node.js binary but the remote/ native modules built for macOS,
# so their .node files are replaced by ones built for Linux in a Docker container from remote/'s lockfile.
set -euo pipefail

arch="${1:?usage: build-server.sh <arm64|x64>}"
case "$arch" in
	arm64) docker_platform=linux/arm64 ;;
	x64) docker_platform=linux/amd64 ;;
	*) echo "Unsupported arch: $arch" >&2; exit 1 ;;
esac

root="$(git rev-parse --show-toplevel)"
cd "$root"
commit="$(git rev-parse HEAD)"
name="vscode-reh-linux-$arch"
out=".build/vsade/$name"
deps=".build/vsade/remote-linux-$arch"

started=$SECONDS
pnpm run gulp "$name-min"
rm -rf "$out"
mkdir -p .build/vsade
mv "../$name" "$out"

# The install reads remote/.pnpmfile.mjs, which imports build/npm/pnpm/nativeBuildEnv.ts.
rm -rf "$deps"
mkdir -p "$deps/remote/web" "$deps/build/npm/pnpm"
cp remote/package.json remote/pnpm-lock.yaml remote/pnpm-workspace.yaml remote/.pnpmfile.mjs "$deps/remote/"
cp remote/web/package.json "$deps/remote/web/"
cp build/npm/pnpm/nativeBuildEnv.ts "$deps/build/npm/pnpm/"
node_version="$(node -p "require('./remote/package.json').nativeBuild.target")"
pnpm_version="$(node -p "require('./package.json').packageManager.split('@')[1]")"
docker run --rm --platform "$docker_platform" -v "$PWD/$deps:/w" -w /w/remote "node:$node_version-bookworm" bash -c "
	set -euo pipefail
	apt-get update -qq && apt-get install -y -qq libkrb5-dev > /dev/null
	npm install --global --silent pnpm@$pnpm_version
	CI=true pnpm install --frozen-lockfile --prod --reporter=append-only > /dev/null"

# Every native module the package carries from remote/ is swapped for its Linux build; one with no Linux build
# (a macOS- or Windows-only module) is dropped.
while IFS= read -r file; do
	linux="$deps/remote/${file#"$out/"}"
	if [[ -f "$linux" ]]; then
		cp "$linux" "$file"
	else
		rm "$file"
	fi
done < <(find "$out/node_modules" -path '*/build/Release/*.node')

# The extension unpacks the archive with --strip-components 1 into ~/<serverDataFolderName>/bin/<commit>.
tarball=".build/vsade/vsade-server-linux-$arch-$commit.tar.gz"
COPYFILE_DISABLE=1 tar --no-xattrs -czf "$tarball" -C .build/vsade "$name"
rm -rf "$out" "$deps"
echo "Built in $((SECONDS - started))s: $PWD/$tarball"
