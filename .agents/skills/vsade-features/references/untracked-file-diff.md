# Untracked File Diff

Clicking an untracked (new, `U`) file in Source Control opens it in the diff editor against an empty original, titled `<name> (Untracked)`, so the whole file renders as added instead of looking like a normal editor. Because the original is the git extension's working-tree diff base (`~` ref), the stock line staging works on it: Stage Selected Ranges, the gutter Stage Block/Stage Selection buttons and Revert Selected Ranges (which deletes the selected lines). After the first partial stage the file is added in the index and modified in the working tree, and upstream's normal flow takes over. Always on; `git.openDiffOnClick: false` still opens the plain file.

## Triggers

- No commands, settings or menus of its own: the click on an untracked resource and `git.openChange` (Open Changes) on one.
- Staging uses the stock `git.stageSelectedRanges`, `git.diff.stageHunk`, `git.diff.stageSelection` and `git.revertSelectedRanges`.

## How It Works

- `ResourceCommandResolver.resolveChangeCommand` gives an `UNTRACKED` resource without a left URI the left URI `toGitUri(file, '~')`, so the command becomes `vscode.diff` instead of `vscode.open`. Files the media preview opens (image, video and audio extensions copied from `IMAGE/VIDEO/AUDIO_PREVIEW_FILE_PATTERN` in `src/vs/workbench/contrib/mediaPreview/common/mediaPreview.ts`) are excluded, because the preview shows "An error occurred while loading the image" for an empty original; keep the regex in step with those patterns. `getLeftResource` is left alone on purpose: `Resource.leftUri` also feeds Open File (HEAD) and the multi-file diff original.
- `GitFileSystemProvider.stat`/`readFile` return an empty file for a `~` ref that git does not know (neither index nor `HEAD`), instead of `FileNotFound`.
- `_stageChanges` applies the selected changes to the empty `~` document, and `Repository.stage` (`git.ts`) adds the path with `update-index --add --cacheinfo 100644`, so a partially staged new script loses its executable bit.
- Side-by-side mode shows an empty left pane; the single all-green view is the inline diff (`diffEditor.renderSideBySide: false`).
- After a partial stage, the open diff tab picks up the new index version through `GitFileSystemProvider.fireChangeEvents`, which waits for the window to have focus (upstream behaviour, same for modified files).
- Intent-to-add files (`git add -N`) are not changed and still open as plain files.

## Files

None of its own; see the patch points.

## Upstream Patch Points

- `extensions/git/src/repository.ts`: `resolveChangeCommand`, one `FORK:` hunk.
- `extensions/git/src/fileSystemProvider.ts`: the `catch` of `stat` and of `readFile`, one `FORK:` hunk each.

## Tests

`extensions/git/src/test/smoke.test.ts`, last test of the suite (`FORK:` hunk): opens an untracked file, checks the diff tab and the empty `~` content, stages the first line and checks the index. Run with `./scripts/test-integration.sh --suite git` after `pnpm run build-fast`.
