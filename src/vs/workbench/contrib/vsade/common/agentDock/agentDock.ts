/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { generateUuid } from '../../../../../base/common/uuid.js';
import { URI } from '../../../../../base/common/uri.js';
import { RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';

/** The view container of the Agent Dock, in the secondary side bar by default. */
export const AGENT_DOCK_CONTAINER_ID = 'vsade.agentDock';

/** The view of the Agent Dock, which hosts its editor part. */
export const AGENT_DOCK_VIEW_ID = 'vsade.agentDock.view';

/** Set in the scoped context of each group of the Agent Dock, such as for the actions of its tab bar. */
export const AgentDockGroupContext = new RawContextKey<boolean>('vsade.agentDockGroup', false);

/**
 * Set to true wherever the Agent Dock exists, such as for keybindings shared with builds without it, which would warn
 * of a command they do not have.
 */
export const AgentDockAvailableContext = new RawContextKey<boolean>('vsade.agentDock.available', false);

/** Set while a Markdown preview has the focus, such as for a keybinding of `vsade.agentDock.insertSelection` there. */
export const AgentDockMarkdownPreviewFocusContext = new RawContextKey<boolean>('vsade.agentDock.markdownPreviewFocus', false);

/**
 * Set while the active editor group is a group of the Agent Dock, such as for a keybinding of
 * `vsade.agentDock.focusEditorArea` there.
 */
export const AgentDockActiveContext = new RawContextKey<boolean>('vsade.agentDock.active', false);

/**
 * Set while the active editor group is the last group of the editor area, such as for a keybinding of
 * `vsade.agentDock.focus` there. `activeEditorGroupLast` does not tell: it counts the groups of every editor part, those
 * of the dock among them.
 */
export const AgentDockActiveEditorAreaGroupLastContext = new RawContextKey<boolean>('vsade.agentDock.activeEditorAreaGroupLast', false);

export const enum AgentDockCommandId {
	Toggle = 'vsade.agentDock.toggle',
	Focus = 'vsade.agentDock.focus',
	FocusEditorArea = 'vsade.agentDock.focusEditorArea',
	NewTerminal = 'vsade.agentDock.newTerminal',
	NewClaudeCode = 'vsade.agentDock.newClaudeCode',
	NewCodex = 'vsade.agentDock.newCodex',
	InsertSelection = 'vsade.agentDock.insertSelection',
}

export const enum AgentDockSettingId {
	Webviews = 'vsade.agentDock.webviews',
	CaptureWebviews = 'vsade.agentDock.captureWebviews',
	SelectionBadge = 'vsade.agentDock.selectionBadge',
	TerminalSelectionDrop = 'vsade.agentDock.terminalSelectionDrop',
}

/** Which selections of an editor show the badge that drags a reference to them into the Agent Dock. */
export const enum AgentDockSelectionBadgeMode {
	/** The selections made with the mouse. */
	Mouse = 'mouse',
	/** Every selection, also one made with the keyboard. */
	Always = 'always',
	Off = 'off',
}

/** What a terminal of the Agent Dock gets when a selection drops on it. */
export const enum AgentDockTerminalSelectionDrop {
	/** A reference to the lines, as the command line of Claude Code reads it. */
	Reference = 'reference',
	/** The selected text. */
	Text = 'text',
}

/** The webview panel of the Claude Code extension, by the view type the extension gives it. */
export const CLAUDE_CODE_WEBVIEW_VIEW_TYPE = 'claudeVSCodePanel';

/** The command of the Claude Code extension that opens a new conversation in an editor tab. */
export const CLAUDE_CODE_OPEN_EDITOR_COMMAND_ID = 'claude-vscode.editor.open';

/** The custom editor of the Codex extension, in which it shows a conversation in an editor tab. */
export const CODEX_CUSTOM_EDITOR_VIEW_TYPE = 'chatgpt.conversationEditor';

/**
 * A resource that the Codex custom editor opens a new conversation for: the one of its "New Codex Agent" command, which
 * the extension reads by its path and query only. The fragment makes each one a new tab: the custom editor takes one tab
 * per resource, so the command reveals the tab it opened before, also once that has a conversation.
 */
export function createCodexNewConversationResource(): URI {
	return URI.from({ scheme: 'openai-codex', authority: 'route', path: '/extension/panel/new', fragment: `vsade-${generateUuid()}` });
}

/** The type id of the editor of a terminal shown as an editor (`TerminalEditorInput.ID`). */
export const TERMINAL_EDITOR_TYPE_ID = 'workbench.editors.terminal';

/** The type id of the editor of a webview panel (`WebviewInput.typeId`). */
export const WEBVIEW_EDITOR_TYPE_ID = 'workbench.editors.webviewInput';

/** The type id of the editor of a custom editor (`CustomEditorInput.typeId`), whose view type is the extension's own. */
export const CUSTOM_EDITOR_TYPE_ID = 'workbench.editors.webviewEditor';

/** What the workbench prefixes the view type of a webview panel of an extension with. */
const EXTENSION_WEBVIEW_VIEW_TYPE_PREFIX = 'mainThreadWebview-';

/** What the Agent Dock needs to know of an editor to decide whether it belongs there. */
export interface IAgentDockEditorDescriptor {
	readonly typeId: string;
	/** The view type of a webview panel or a custom editor, as the workbench has it. */
	readonly viewType?: string;
}

/**
 * The view type of `editor` as its extension registers it: the one it gives to `createWebviewPanel` for a webview panel of
 * an extension, or to `registerCustomEditorProvider` for a custom editor. Nothing for any other editor.
 */
function getExtensionViewType(editor: IAgentDockEditorDescriptor): string | undefined {
	if (editor.typeId === WEBVIEW_EDITOR_TYPE_ID && editor.viewType?.startsWith(EXTENSION_WEBVIEW_VIEW_TYPE_PREFIX)) {
		return editor.viewType.substring(EXTENSION_WEBVIEW_VIEW_TYPE_PREFIX.length);
	}

	if (editor.typeId === CUSTOM_EDITOR_TYPE_ID) {
		return editor.viewType;
	}

	return undefined;
}

/**
 * Whether `editor` is a webview panel or a custom editor of an extension whose view type is one of `webviews`, as the
 * extension registers it.
 */
export function isAgentDockWebview(editor: IAgentDockEditorDescriptor, webviews: readonly string[]): boolean {
	const viewType = getExtensionViewType(editor);
	return !!viewType && webviews.includes(viewType);
}

/** Whether `editor` may stay in the Agent Dock: a terminal, or one of the `webviews` panels. */
export function isAgentDockEditor(editor: IAgentDockEditorDescriptor, webviews: readonly string[]): boolean {
	return editor.typeId === TERMINAL_EDITOR_TYPE_ID || isAgentDockWebview(editor, webviews);
}
