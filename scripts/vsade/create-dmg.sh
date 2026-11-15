#!/usr/bin/env bash
# Builds a .dmg for a packaged app the way build/darwin/create-dmg.ts does (dmgbuild at the commit it
# pins, in the git-ignored build/darwin/.dmgbuild venv it uses, with build/darwin/dmg-settings.py.template),
# except that the volume is named after product.json: upstream hard-codes "Code OSS" / "VS Code".
#
# Usage: scripts/vsade/create-dmg.sh <path/to/App.app> <path/to/output.dmg>
set -euo pipefail

if [[ $# -ne 2 ]]; then
	echo "Usage: $0 <path/to/App.app> <path/to/output.dmg>" >&2
	exit 1
fi

ROOT="$(cd "$(dirname "$0")/../.." && pwd)"
APP_PATH="$(cd "$(dirname "$1")" && pwd)/$(basename "$1")"
mkdir -p "$(dirname "$2")"
DMG_PATH="$(cd "$(dirname "$2")" && pwd)/$(basename "$2")"
DMGBUILD_DIR="$ROOT/build/darwin/.dmgbuild"
PYTHON="$DMGBUILD_DIR/venv/bin/python3"

test -d "$APP_PATH" || { echo "App not found: $APP_PATH" >&2; exit 1; }

if [[ ! -f "$DMGBUILD_DIR/.installed" ]]; then
	repo="$(sed -n "s/^const DMGBUILD_REPO = '\(.*\)';$/\1/p" "$ROOT/build/darwin/create-dmg.ts")"
	commit="$(sed -n "s/^const DMGBUILD_COMMIT = '\(.*\)';$/\1/p" "$ROOT/build/darwin/create-dmg.ts")"
	test -n "$repo" && test -n "$commit" || { echo "Cannot read the dmgbuild repository and commit from build/darwin/create-dmg.ts" >&2; exit 1; }
	python3 -c 'import sys; sys.exit(sys.version_info < (3, 10))' || { echo "dmgbuild needs Python >= 3.10 as python3 (brew install python@3.12)" >&2; exit 1; }
	rm -rf "$DMGBUILD_DIR"
	git clone --quiet "$repo" "$DMGBUILD_DIR"
	git -C "$DMGBUILD_DIR" -c advice.detachedHead=false checkout --quiet "$commit"
	python3 -m venv "$DMGBUILD_DIR/venv"
	"$DMGBUILD_DIR/venv/bin/pip" install --quiet "$DMGBUILD_DIR"
	printf 'Installed at %s\nCommit: %s\n' "$(date -u +%FT%TZ)" "$commit" > "$DMGBUILD_DIR/.installed"
fi

VOLUME_NAME="$(node -p "require('$ROOT/product.json').nameLong")"
TMP_DIR="$(mktemp -d)"
trap 'rm -rf "$TMP_DIR"' EXIT
SETTINGS="$TMP_DIR/dmg-settings.py"

# Same substitutions as create-dmg.ts; the stable background is a plain arrow without product branding.
node -e '
	const fs = require("fs");
	const [template, settings, volumeName, badgeIcon, background, appPath] = process.argv.slice(1);
	const content = fs.readFileSync(template, "utf8")
		.replace("{{VOLUME_NAME}}", JSON.stringify(volumeName))
		.replace("{{BADGE_ICON}}", JSON.stringify(badgeIcon))
		.replace("{{BACKGROUND}}", JSON.stringify(background))
		.replace("{{APP_PATH}}", JSON.stringify(appPath))
		.replace("{{APP_NAME}}", JSON.stringify(require("path").basename(appPath)));
	fs.writeFileSync(settings, content);
' "$ROOT/build/darwin/dmg-settings.py.template" "$SETTINGS" "$VOLUME_NAME" \
	"$ROOT/resources/darwin/code.icns" "$ROOT/build/darwin/dmg-background-stable.tiff" "$APP_PATH"

rm -f "$DMG_PATH"
"$PYTHON" -m dmgbuild -s "$SETTINGS" "$VOLUME_NAME" "$DMG_PATH"
test -f "$DMG_PATH"
echo "Created $DMG_PATH ($(du -h "$DMG_PATH" | cut -f1))"
