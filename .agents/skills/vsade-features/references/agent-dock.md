# Agent Dock

An editor part of its own, shown as the view `vsade.agentDock.view` in the view container `vsade.agentDock` (secondary side bar, `ViewContainerLocation.AuxiliaryBar`). It holds only agent tabs: terminals, Claude Code conversations (webview `claudeVSCodePanel`) and Codex conversations (custom editor `chatgpt.conversationEditor`). Its groups are locked and never preview, so files always open in the editor area and anything else that lands in the dock moves out. It can be split, its tabs line up with the editor area's tab bar, and it restores across reloads with terminals reconnecting.

Paths below are relative to `src/vs/workbench/contrib/vsade/`.

## UI Parts

| The owner says | What it is | Where |
|---|---|---|
| the dock | The editor part laid over the whole view, title included | `browser/agentDock/agentDockView.ts` (`AgentDockViewPane`), part created in `browser/agentDock/agentDockService.ts` (`createEditorPart`) |
| dock tab bar, dock buttons | `MenuId.EditorTitle` entries gated on the scoped context key `vsade.agentDockGroup`, in order: New Terminal (`-3`), New Claude Code (`-2`, `Codicon.claude`, orange through `vsade.agentDock.claudeCodeIconForeground`, `browser/agentDock/agentDockColors.ts`), New Codex (`-1`, `Codicon.openai`) | `browser/agentDock/agentDock.contribution.ts` |
| empty dock | `MenuId.ViewTitle` buttons (orders 1-3) and the welcome text with New Terminal / New Claude Code / New Codex links; only visible while the dock has no tab | `browser/agentDock/agentDock.contribution.ts` |
| selection badge, Drag to Agent | The `@` pill next to an editor or Markdown preview selection; dragging it drops a line reference on an agent tab | `browser/agentDock/agentDockSelectionBadge.ts` (editor), `extensions/markdown-language-features/preview-src/vsadeSelectionBadge.ts` (preview) |
| drop into a tab | Files, folders and selections dropped onto a dock tab become `@path` mentions (Claude Code), `add-context-file` messages (Codex) or paths/text (terminal) | `browser/agentDock/agentDockDropController.ts`, `common/agentDock/agentDockDrop.ts` |

## Commands

| Id | Title | Notes |
|---|---|---|
| `vsade.agentDock.toggle` | View: Toggle Agent Dock | Shows or hides; opens a Claude Code conversation if the dock has none. No default keybinding; meant for cmd+] in the user's keybindings. |
| `vsade.agentDock.focus` | Focus Agent Dock | |
| `vsade.agentDock.focusEditorArea` | Focus Editor Area | |
| `vsade.agentDock.newTerminal` | New Terminal in Agent Dock | View title + dock tab bar |
| `vsade.agentDock.newClaudeCode` | New Claude Code in Agent Dock | View title + dock tab bar. Runs `claude-vscode.editor.open` with the dock group's column, so it opens a new conversation in the dock. |
| `vsade.agentDock.newCodex` | New Codex in Agent Dock | View title + dock tab bar. Opens `openai-codex://route/extension/panel/new#vsade-<uuid>` with `override: 'chatgpt.conversationEditor'`. |
| `vsade.agentDock.insertSelection` | Insert Selection into Agent Dock | Editor or Markdown preview selection into the last active agent |

## Settings and Context Keys

- `vsade.agentDock.webviews` (default `["claudeVSCodePanel", "chatgpt.conversationEditor"]`): view types that belong in the dock.
- `vsade.agentDock.captureWebviews` (default `true`): move those panels into the dock wherever they open.
- `vsade.agentDock.selectionBadge` (`mouse` default, `always`, `off`).
- `vsade.agentDock.terminalSelectionDrop` (`reference` default, `text`).
- Colour `vsade.agentDock.claudeCodeIconForeground` (default `#D97757`, the Claude logo's orange; none in high contrast): the New Claude Code buttons in the dock, applied by a theming participant.
- Context keys: `vsade.agentDockGroup` (scoped to dock groups), `vsade.agentDock.available`, `vsade.agentDock.active`, `vsade.agentDock.activeEditorAreaGroupLast`, `vsade.agentDock.markdownPreviewFocus`.

## Files

- `browser/agentDock/agentDock.contribution.ts`: view container, view, welcome, settings, actions, workbench contributions.
- `browser/agentDock/agentDockService.ts`: `IAgentDockService`; creates and locks the part, moves panels in and editors out, persists state, `openClaudeCode()` / `openCodex()`.
- `browser/agentDock/agentDockOpenWith.ts`: keeps Codex tabs in the dock when the extension reopens them through `vscode.openWith`.
- `browser/agentDock/agentDockInsertService.ts`: inserts references into a terminal, Claude Code or Codex.
- `browser/agentDock/agentDockPreviewSelection.ts`, `agentDockPreviewDrag.ts`: Markdown preview selection and drag (shared with Copy Original Text).
- `common/agentDock/agentDock.ts`: ids, context keys, Claude/Codex constants, `isAgentDockEditor`, `isAgentDockWebview`.
- `common/agentDock/agentDockDrop.ts`, `common/agentDock/agentDockPreview.ts`: drop targets, message builders, preview message protocol.
- `browser/agentDock/media/agentDock.css`, `browser/agentDock/media/agentDockSelectionBadge.css`.

## Upstream Patch Points

- `extensions/markdown-language-features/preview-src/index.ts`: two `FORK:` hunks that start `startVsadeSelectionBadge` in the preview.
- Shared by every core feature: the `FORK:` import in `src/vs/workbench/workbench.common.main.ts` and the ledger line for `build/lib/i18n.resources.json`.

## External Dependencies

- Claude Code extension: webview view type `claudeVSCodePanel`, command `claude-vscode.editor.open` (takes a column). Its own `editor/title` button (`claude-vscode.editor.openLast`, the orange logo) shows in every editor title bar; the owner hides it with right-click > Hide and uses the dock's button instead.
- Codex extension: custom editor `chatgpt.conversationEditor`, `openai-codex:` URIs, and an `add-context-file` message shape pinned to Codex 26.1120.50957 (`createCodexAddContextFileMessage`). Its own `editor/title` button (`chatgpt.openSidebar`) opens its sidebar, which replaces the dock.
- Neither extension is detected up front: the buttons always show, and a click without the extension shows "Could not open ...".

## Tests

`test/common/agentDock/agentDock.test.ts` (editor classification), `agentDockDrop.test.ts` (drop targets and messages), `agentDockPreview.test.ts` (line ranges, message parsing). No tests for actions, menus or the service.
