# Multibuffer

A Zed-style editor tab that stacks excerpts of real files: the lines around each match, with the rest hidden. Sources are a workspace text search or Find All References. Excerpts are read-only views of the real text models, so language features and editor keybindings work inside them. Files near the viewport load ahead of scrolling.

Paths below are relative to `src/vs/workbench/contrib/vsade/`.

## UI Parts

| The owner says | What it is | Where |
|---|---|---|
| top search bar, multibuffer search input | `.vsade-multibuffer-header`: a `MenuWorkbenchToolBar` (`vsade.multibuffer.headerToolbar`: Show Only Matching Lines / Show Lines Around Matches), a `ContextScopedFindInput` with Aa / ab / .* toggles, and the "N matches in M files" summary | `browser/multibuffer/multibufferEditor.ts` (`createEditor`, `createSearchInput`) |
| file header | `.vsade-multibuffer-file-header`: collapse chevron, file icon + workspace-relative path (one `ResourceLabel` name, multi-root `folder • path`, outside the workspace `~/...`), "N matches", Open File / Open File to the Side (`vsade.multibuffer.fileToolbar`). Draggable like an editor tab. | `browser/multibuffer/multibufferFileTemplate.ts` (`renderLabel`, `createBinding`) |
| excerpt | The `CodeEditorWidget` of one file with hidden areas outside its excerpts | `browser/multibuffer/multibufferFileTemplate.ts`, `common/multibuffer/multibufferExcerpts.ts` |
| hidden lines row, "N hidden lines" | The separator view zone between excerpts, with expand up/down | `browser/multibuffer/multibufferFileTemplate.ts` (`.vsade-multibuffer-separator`) |
| multibuffer Cmd+F, find widget | A `SimpleFindWidget` subclass that finds in the shown lines of all files; replaces the stock editor find, which is removed from the excerpts' contributions. Follows `editor.find.cursorMoveOnType`: when it is `false`, typing only highlights ("? of N") and Enter or the arrows move. | `browser/multibuffer/multibufferFindWidget.ts`, `common/multibuffer/multibufferFind.ts` |
| match highlight | Decoration `vsade-multibuffer-match` on the search or reference matches; green by default so it differs from the Cmd+F matches, which use upstream's find decorations | `browser/multibuffer/multibufferColors.ts` |

## Commands

| Id | Title | Keys / menus |
|---|---|---|
| `vsade.multibuffer.search` | Multibuffer: Search in Multibuffer | Command Palette; optional string argument is the pattern |
| `vsade.multibuffer.findReferences` | Multibuffer: Find All References in Multibuffer | Editor context menu (`navigation`, 1.46) |
| `vsade.multibuffer.find` / `findNext` / `findPrevious` / `closeFind` | Find in Multibuffer, ... | Cmd+F, Cmd+G / F3, Shift+Cmd+G / Shift+F3, Escape, inside a multibuffer |
| `vsade.multibuffer.openFile` / `openFileToSide` | Open File, Open File to the Side | File header toolbar, editor context menu in a multibuffer |
| `vsade.multibuffer.expandExcerptUp` / `expandExcerptDown` | Expand Excerpt Up/Down | Hidden lines row |
| `vsade.multibuffer.showMatchLinesOnly` / `showExcerpts` | Show Only Matching Lines / Show Lines Around Matches | Top bar toolbar |

## Settings, Colours, Context Keys

- `vsade.multibuffer.contextLines` (6), `vsade.multibuffer.expandLines` (20), `vsade.multibuffer.maxResults` (5000), `vsade.multibuffer.doubleClickBehaviour` (`openFile` default, `selectWord`, `openFileToSide`).
- Colours (applied by a theming participant, because fork colours cannot be used from CSS without patching `vscode-known-variables.json`): `vsade.multibuffer.matchHighlightBackground` (translucent green `#2EA04366` dark, `#2EA04355` light), `vsade.multibuffer.matchHighlightBorder` (high-contrast border).
- Context keys: `vsade.multibuffer`, `vsade.multibuffer.findVisible`, `vsade.multibuffer.findFocused`, `vsade.multibuffer.matchLinesOnly`.
- Editor id `vsade.multibuffer.editor`, input type `vsade.multibuffer.input`.

## Files

- `browser/multibuffer/multibuffer.contribution.ts`: editor pane and settings.
- `browser/multibuffer/multibufferActions.ts`: all commands.
- `browser/multibuffer/multibufferEditor.ts`, `multibufferEditorInput.ts`: the pane with its top bar, and the input (tab title "{query} (N matches in M files)").
- `browser/multibuffer/multibufferWidget.ts`: virtualized list of file templates.
- `browser/multibuffer/multibufferFileTemplate.ts`: file header, excerpt editor, hidden lines rows, find decorations.
- `browser/multibuffer/multibufferModel.ts`, `multibufferSources.ts` (references grouped per file), `multibufferTextSearch.ts` (workspace folders as roots).
- `common/multibuffer/`: ids, excerpt maths, find, search result mapping.
- `browser/multibuffer/media/multibuffer.css`.

## Upstream Patch Points

None; fork-owned files only.

## Tests

`test/browser/multibuffer/multibufferWidget.test.ts` (shown/hidden lines, edits, expand, dispose), `multibufferSources.test.ts`, `test/common/multibuffer/multibufferExcerpts.test.ts`, `multibufferFind.test.ts`. No test covers header text or colours.
