# Git Snapshot Language Features

Go to Definition, Declaration, Type Definition, Implementation, Find All References and hover work in the read-only `git:` documents the git extension opens, such as the staged "(Index)" version of a file or the HEAD side of a diff. Language servers only serve files on disk, so each request is answered by the providers of the working-tree file: the position is mapped from the snapshot to the file through a diff, falling back to the same identifier inside an edited hunk, and nothing is returned when the symbol cannot be found. Results reflect the file on disk, including unstaged changes.

Paths below are relative to `src/vs/workbench/contrib/vsade/`.

## Triggers

- No commands, menus or keybindings of its own: the stock editor commands, run inside a `git:` document. Providers are registered for `{ scheme: 'git' }`.
- Setting `vsade.gitSnapshotLanguageFeatures.enabled` (default `true`, window scope), applied live.
- Workbench contribution `vsade.gitSnapshotLanguageFeatures` (`AfterRestored`).

## How It Works

- Navigation providers stay silent when another provider for the snapshot already answers, so languages whose servers accept `git:` documents get no duplicates. Hover has no such check.
- `GitSnapshotTargetResolver` keeps a model reference to the working-tree file per snapshot and caches the diff per (snapshot version, file version); `computeDiff` uses the `advanced` algorithm with a 1000 ms limit, and a timed-out diff gives no result.
- `mapSnapshotPosition` keeps the column on unchanged lines, otherwise picks the nearest whole-word match of the identifier in the modified side of the change.
- Submodule snapshots (`submoduleOf`) are skipped.

## Files

- `browser/gitSnapshotLanguageFeatures/gitSnapshotLanguageFeatures.contribution.ts`: setting and toggle.
- `browser/gitSnapshotLanguageFeatures/gitSnapshotLanguageFeatures.ts`: resolver and the six providers.
- `browser/gitSnapshotLanguageFeatures/gitSnapshotPositionMapper.ts`: `mapSnapshotPosition`.
- `common/gitSnapshotLanguageFeatures/gitSnapshotLanguageFeatures.ts`: setting id.
- `common/gitResource.ts`: `parseGitResource`, also used by the Agent Dock file drop.

## Dependencies

- The git extension's URI shape (`extensions/git/src/uri.ts`): scheme `git`, JSON query `{ path, ref, submoduleOf? }`, `''` or `~` for the index.
- Internal upstream helpers that an upstream merge can break: `translatePosition` (`src/vs/editor/browser/widget/diffEditor/utils.ts`), `getDefinitionsAtPosition` and siblings (`src/vs/editor/contrib/gotoSymbol/browser/goToSymbol.ts`), `getHoversPromise` (`src/vs/editor/contrib/hover/browser/getHover.ts`).

## Upstream Patch Points

None.

## Tests

`test/browser/gitSnapshotLanguageFeatures/gitSnapshotPositionMapper.test.ts`, `test/common/gitResource.test.ts`. The providers and the resolver have no tests.
