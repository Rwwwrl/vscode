# Markdown Preview: Copy Original Text

**Copy Original Text** in the Markdown preview's context menu (after Copy) and the Command Palette copies the Markdown source of the whole blocks a selection spans instead of their rendered text: the LaTeX of a `$$` or fenced `math` block, the pipe rows of a table, a paragraph with its inline `$...$`. It also makes math blocks keep their source line whichever extension renders them, which fixes the preview's selection mapping, shared with the Agent Dock selection badge.

## Triggers

- Command `vsade.markdownPreview.copyOriginalText`, "Markdown: Copy Original Text", in the Command Palette.
- `MenuId.WebviewContext`, group `5_cutcopypaste`, order 2.5, when `webviewId` is `markdown.preview` or `vscode.markdown.preview.editor` and not `preventDefaultContextMenuItems`.
- No keybinding or setting. With nothing selected it shows "Select text in a Markdown preview to copy its original Markdown."

## How It Works

The workbench asks the preview for its selection (`vsade.agentDock.selectionRequest`), the preview answers with block lines (`vsade.agentDock.selection`: `startLine`, `endBlockLine`, `nextBlockLine`, 2 s timeout), and the command copies those whole lines from the source file (opened through `ITextModelService`, so it need not be open). Previews are tried in order: focused webview, active editor, the rest.

## Files

- `src/vs/workbench/contrib/vsade/browser/markdownPreview/markdownPreview.contribution.ts`: the action.
- `src/vs/workbench/contrib/vsade/browser/agentDock/agentDockPreviewSelection.ts`: `requestAgentDockPreviewBlocks`, shared with Agent Dock.
- `src/vs/workbench/contrib/vsade/common/agentDock/agentDockPreview.ts`: message protocol and `getAgentDockPreviewLineRange`.
- `extensions/markdown-language-features/preview-src/vsadeSelectionBadge.ts` (fork-owned, from Agent Dock #4 and #6, selection mapping reworked in #15): maps a DOM selection to blocks and answers requests.
- `extensions/markdown-language-features/src/vsadeSourceLines.ts` (fork-owned): `keepSourceLinesOfBlocks` wraps `math_block`, `math_inline_block`, `math_inline_bare_block` and `fence` output in a `div` carrying `data-line` when the renderer dropped it.

## Upstream Patch Points

- `extensions/markdown-language-features/src/markdownEngine.ts`: two `FORK:` hunks (import, and `keepSourceLinesOfBlocks(md)` after all plugins, the only place that sees the final renderer).
- `extensions/markdown-language-features/preview-src/index.ts`: two `FORK:` hunks from Agent Dock that start the selection script.

## Limits

Whole blocks only, since the preview knows only where each block starts. A preview of another version of the file is rejected only when its lines run past the end of the file. No unit tests for the selection mapping or the renderer wrapper.
