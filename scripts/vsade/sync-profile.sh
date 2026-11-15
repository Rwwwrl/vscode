#!/usr/bin/env bash
#
# Copies settings, keybindings, snippets and extensions from the stock VS Code
# install into this fork's profiles. Nothing is read from or written to the repo.
#
# Usage: scripts/vsade/sync-profile.sh [app|dev|all]
#   app  the packaged app          (~/Library/Application Support/<nameShort>, ~/<dataFolderName>)
#   dev  the build run from sources (~/Library/Application Support/code-oss-dev, ~/<dataFolderName>-dev)
#
# Override the source with VSADE_SOURCE_USER_DIR / VSADE_SOURCE_EXTENSIONS_DIR.
# Existing target files are kept as <name>.bak-<timestamp>; extensions that only
# exist in the target are left alone.

set -euo pipefail

if [[ "$OSTYPE" != "darwin"* ]]; then
	echo "sync-profile: only macOS is supported" >&2
	exit 1
fi

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
TARGET="${1:-all}"

NAME_SHORT="$(node -p "require('$ROOT/product.json').nameShort")"
DATA_FOLDER="$(node -p "require('$ROOT/product.json').dataFolderName")"

SOURCE_USER_DIR="${VSADE_SOURCE_USER_DIR:-$HOME/Library/Application Support/Code/User}"
SOURCE_EXTENSIONS_DIR="${VSADE_SOURCE_EXTENSIONS_DIR:-$HOME/.vscode/extensions}"
STAMP="$(date +%Y%m%d-%H%M%S)"

function copy_file() {
	local source="$1" target="$2"
	if [[ ! -f "$source" ]]; then
		return
	fi
	if [[ -f "$target" ]] && ! cmp -s "$source" "$target"; then
		cp -p "$target" "$target.bak-$STAMP"
		echo "    kept previous $(basename "$target") as $(basename "$target").bak-$STAMP"
	fi
	cp -p "$source" "$target"
	echo "    $(basename "$target")"
}

function sync_into() {
	local label="$1" user_dir="$2" extensions_dir="$3"

	echo "==> $label"
	echo "  user data:  $user_dir"
	mkdir -p "$user_dir"
	copy_file "$SOURCE_USER_DIR/settings.json" "$user_dir/settings.json"
	copy_file "$SOURCE_USER_DIR/keybindings.json" "$user_dir/keybindings.json"
	if [[ -d "$SOURCE_USER_DIR/snippets" ]]; then
		mkdir -p "$user_dir/snippets"
		rsync -a "$SOURCE_USER_DIR/snippets/" "$user_dir/snippets/"
		echo "    snippets/"
	fi

	echo "  extensions: $extensions_dir"
	if [[ ! -f "$SOURCE_EXTENSIONS_DIR/extensions.json" ]]; then
		echo "    no extensions.json in $SOURCE_EXTENSIONS_DIR, skipped"
		return
	fi
	mkdir -p "$extensions_dir"
	rsync -a --exclude 'extensions.json' --exclude '.obsolete' --exclude '.init-default-profile-extensions' \
		"$SOURCE_EXTENSIONS_DIR/" "$extensions_dir/"

	# The manifest stores absolute locations, so it is rewritten rather than copied.
	node - "$SOURCE_EXTENSIONS_DIR/extensions.json" "$extensions_dir" <<'EOF'
const fs = require('fs');
const path = require('path');
const [sourceManifest, targetDir] = process.argv.slice(2);
const targetManifest = path.join(targetDir, 'extensions.json');
const key = e => e.identifier.id.toLowerCase();
const merged = new Map();
if (fs.existsSync(targetManifest)) {
	for (const e of JSON.parse(fs.readFileSync(targetManifest, 'utf8'))) {
		merged.set(key(e), e);
	}
}
let count = 0;
for (const e of JSON.parse(fs.readFileSync(sourceManifest, 'utf8'))) {
	const folder = e.relativeLocation ?? path.basename(e.location.path);
	if (!fs.existsSync(path.join(targetDir, folder))) {
		continue;
	}
	merged.set(key(e), { ...e, location: { ...e.location, path: path.join(targetDir, folder) }, relativeLocation: folder });
	count++;
}
fs.writeFileSync(targetManifest, JSON.stringify([...merged.values()]));
console.log(`    ${count} extensions synced, ${merged.size} in manifest`);
EOF
}

case "$TARGET" in
	app | dev | all) ;;
	*)
		echo "usage: $0 [app|dev|all]" >&2
		exit 1
		;;
esac

if [[ ! -d "$SOURCE_USER_DIR" ]]; then
	echo "sync-profile: source profile not found: $SOURCE_USER_DIR" >&2
	exit 1
fi

if [[ "$TARGET" == "app" || "$TARGET" == "all" ]]; then
	sync_into "$NAME_SHORT (packaged app)" "$HOME/Library/Application Support/$NAME_SHORT/User" "$HOME/$DATA_FOLDER/extensions"
fi
if [[ "$TARGET" == "dev" || "$TARGET" == "all" ]]; then
	# Running from sources has a fixed user data folder name, see src/vs/platform/environment/node/userDataPath.ts
	sync_into "$NAME_SHORT Dev (run from sources)" "$HOME/Library/Application Support/code-oss-dev/User" "$HOME/$DATA_FOLDER-dev/extensions"
fi

echo "Done. Restart $NAME_SHORT to pick up the changes."
