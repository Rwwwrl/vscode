#!/usr/bin/env bash
#
# Lists every upstream-owned file the fork modifies and fails when a change is
# not highlighted. A file is upstream-owned when it exists on the upstream mirror
# branch; files the fork added are fork-owned and are not listed.
#
# A change is highlighted when either
#   - every hunk adds a line containing the marker "FORK:" (a comment directly
#     above the hunk), or
#   - the file cannot hold comments (JSON, generated files) and is recorded in
#     scripts/vsade/fork-patches.txt as "<path><TAB><reason>".
#
# Usage: scripts/vsade/fork-patches.sh [base-ref]
#   base-ref  upstream mirror to compare against (default: main)
# Uncommitted changes to tracked files are included.

set -euo pipefail

ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
cd "$ROOT"

MARKER='FORK:'
LEDGER='scripts/vsade/fork-patches.txt'
BASE_REF="${1:-main}"

if ! BASE="$(git merge-base "$BASE_REF" HEAD 2>/dev/null)"; then
	echo "fork-patches: cannot find a merge base with '$BASE_REF'" >&2
	exit 2
fi

function ledger_reason() {
	if [[ -f "$LEDGER" ]]; then
		awk -F '\t' -v path="$1" '$1 == path { print $2; found = 1; exit } END { exit !found }' "$LEDGER"
	else
		return 1
	fi
}

# Prints the number of hunks and the number of hunks without a marker line.
function count_hunks() {
	git diff -U0 "$BASE" -- "$1" | awk -v marker="$MARKER" '
		/^@@/ { if (hunks > 0 && !marked) { unmarked++ } hunks++; marked = 0; next }
		hunks > 0 && /^\+/ && index($0, marker) { marked = 1 }
		END { if (hunks > 0 && !marked) { unmarked++ } printf "%d %d\n", hunks, unmarked }'
}

failures=0
total=0

while IFS=$'\t' read -r status path renamed; do
	if [[ -z "$status" ]]; then
		continue
	fi
	total=$((total + 1))

	if reason="$(ledger_reason "$path")"; then
		printf 'ok       %s\n           ledger: %s\n' "$path" "$reason"
		continue
	fi

	case "$status" in
		D)
			printf 'MISSING  %s\n           upstream file deleted: record it in %s\n' "$path" "$LEDGER"
			failures=$((failures + 1))
			continue
			;;
		R*)
			printf 'MISSING  %s -> %s\n           upstream file renamed: record it in %s\n' "$path" "$renamed" "$LEDGER"
			failures=$((failures + 1))
			continue
			;;
	esac

	read -r hunks unmarked < <(count_hunks "$path")
	if [[ "$unmarked" -eq 0 ]]; then
		printf 'ok       %s\n           %d marked hunk(s)\n' "$path" "$hunks"
	else
		printf 'MISSING  %s\n           %d of %d hunk(s) without a "%s" marker\n' "$path" "$unmarked" "$hunks" "$MARKER"
		failures=$((failures + 1))
	fi
done < <(git diff --name-status --diff-filter=MDRT "$BASE")

echo
echo "$total upstream-owned file(s) modified relative to $BASE_REF ($(git rev-parse --short "$BASE"))."
if [[ "$failures" -gt 0 ]]; then
	echo "$failures file(s) are not highlighted. Add a \"$MARKER <why>\" comment above each hunk, or a line in $LEDGER for files that cannot hold comments." >&2
	exit 1
fi
