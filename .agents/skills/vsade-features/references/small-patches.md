# Small Patches

Changes too small to be a feature of their own.

| Name | What | Where | Pull request |
|---|---|---|---|
| Narrow diff overview ruler | The red/green change lanes at the right edge of a side-by-side diff are 5px each (upstream 15), 10px in total | `FORK:` hunk on `ONE_OVERVIEW_WIDTH` in `src/vs/editor/browser/widget/diffEditor/features/overviewRulerFeature.ts` | #9 |
| App icon | The VS Code logo on a black background | `resources/darwin/code.icns` (binary, ledger line in `scripts/vsade/fork-patches.txt`); `just install` refreshes the icon cache | #7, #10 |
| Rebrand | App `vsade`, CLI `ade`, bundle id `dev.vsade.app`, URL protocol `vsade`, Open VSX gallery | `product.json` (ledger line) | #1 |
| Gallery hygiene | `build/hygiene.ts` rejects only a Microsoft Marketplace gallery in `product.json` | `FORK:` hunk in `build/hygiene.ts` | #1 |
| justfile indentation | The space-indented `justfile` is exempt from the tab and copyright checks | `FORK:` hunk in `build/filters.ts` | #1 |

## Fork Scripts and Recipes

- `scripts/vsade/fork-patches.sh` and the ledger `fork-patches.txt`: the `just fork-patches` check.
- `scripts/vsade/sign-app.sh`: signs the packaged app with a local self-signed certificate (`~/.vsade/signing`), so keychain "Always Allow" survives rebuilds.
- `scripts/vsade/create-dmg.sh`: builds the `.dmg`, naming the volume from `product.json`.
- `scripts/vsade/sync-profile.sh`: `just sync-profile`, copies the stock VS Code profile into the vsade profiles and applies `~/.vsade/settings.overrides.json`.
- `scripts/vsade/sosov-fork-ruleset.json`: GitHub ruleset for `sosov-fork` (pull requests only, squash, no force-push).
- `justfile`: `build-dev`, `run-dev`, `build`, `install`, `clean`, `sync-profile`, `typecheck`, `test`, `lint`, `hygiene`, `fork-patches` (see `CLAUDE.md`).
