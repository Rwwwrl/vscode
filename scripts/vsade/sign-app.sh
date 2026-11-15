#!/usr/bin/env bash
#
# Signs a packaged app with a self-signed code signing certificate that is created
# on first use and kept in its own keychain outside the repository.
#
# Why not ad hoc: an ad-hoc signature is identified by the hash of the build, so
# every build is a different app to macOS and "Always Allow" on the app's
# "Safe Storage" keychain item is forgotten. A certificate gives every build the
# same designated requirement (bundle identifier + certificate), so it is kept.
#
# The certificate is not trusted by the system and is not a Developer ID: the
# result runs on this machine, and Gatekeeper still rejects it elsewhere.
#
# Usage: scripts/vsade/sign-app.sh <path/to/App.app>
#   VSADE_SIGNING_DIR  where the keychain lives (default: ~/.vsade/signing)
# Delete that folder to start over with a new certificate.

set -euo pipefail

if [[ $# -ne 1 || ! -d "$1" ]]; then
	echo "Usage: $0 <path/to/App.app>" >&2
	exit 1
fi

APP="$1"
SIGNING_DIR="${VSADE_SIGNING_DIR:-$HOME/.vsade/signing}"
KEYCHAIN="$SIGNING_DIR/signing.keychain-db"
PASSWORD_FILE="$SIGNING_DIR/password"
IDENTITY="vsade Local Code Signing"

function create_identity() {
	local tmp password
	tmp="$(mktemp -d)"
	trap 'rm -rf "$tmp"' RETURN

	umask 077
	mkdir -p "$SIGNING_DIR"
	password="$(/usr/bin/openssl rand -hex 24)"
	printf '%s' "$password" > "$PASSWORD_FILE"

	cat > "$tmp/request.cnf" <<-EOF
		[req]
		distinguished_name = dn
		x509_extensions = ext
		prompt = no
		[dn]
		CN = $IDENTITY
		[ext]
		basicConstraints = critical,CA:false
		keyUsage = critical,digitalSignature
		extendedKeyUsage = critical,codeSigning
	EOF
	# The system LibreSSL writes a PKCS#12 file that `security import` can read; OpenSSL 3 does not by default.
	/usr/bin/openssl req -x509 -newkey rsa:2048 -nodes -days 7300 -config "$tmp/request.cnf" \
		-keyout "$tmp/key.pem" -out "$tmp/certificate.pem" 2>/dev/null
	/usr/bin/openssl pkcs12 -export -inkey "$tmp/key.pem" -in "$tmp/certificate.pem" \
		-name "$IDENTITY" -passout "pass:$password" -out "$tmp/identity.p12"

	# A keychain created by path is not added to the user's keychain search list.
	security create-keychain -p "$password" "$KEYCHAIN"
	security set-keychain-settings "$KEYCHAIN"
	security unlock-keychain -p "$password" "$KEYCHAIN"
	security import "$tmp/identity.p12" -k "$KEYCHAIN" -P "$password" -T /usr/bin/codesign > /dev/null
	# Lets codesign use the key without a confirmation dialog.
	security set-key-partition-list -S apple-tool:,apple: -s -k "$password" "$KEYCHAIN" > /dev/null
	echo "Created the signing certificate \"$IDENTITY\" in $KEYCHAIN"
}

if [[ ! -f "$KEYCHAIN" && ! -f "$PASSWORD_FILE" ]]; then
	create_identity
elif [[ ! -f "$KEYCHAIN" || ! -f "$PASSWORD_FILE" ]]; then
	echo "sign-app: $SIGNING_DIR is incomplete; delete it to create a new certificate" >&2
	exit 1
fi

# A locked keychain would make codesign ask for its password in a dialog.
security unlock-keychain -p "$(cat "$PASSWORD_FILE")" "$KEYCHAIN"
codesign --force --deep --keychain "$KEYCHAIN" --sign "$IDENTITY" "$APP"
codesign --verify --deep --strict "$APP"
echo "Signed $APP as \"$IDENTITY\""
