/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';

/** The view container of the Agent Dock, in the secondary side bar by default. */
export const AGENT_DOCK_CONTAINER_ID = 'vsade.agentDock';

/** The view of the Agent Dock, which hosts its editor part. */
export const AGENT_DOCK_VIEW_ID = 'vsade.agentDock.view';

/** Set in the scoped context of each group of the Agent Dock, such as for the actions of its tab bar. */
export const AgentDockGroupContext = new RawContextKey<boolean>('vsade.agentDockGroup', false);

export const enum AgentDockCommandId {
	Toggle = 'vsade.agentDock.toggle',
	NewTerminal = 'vsade.agentDock.newTerminal',
	NewClaudeCode = 'vsade.agentDock.newClaudeCode',
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

/** The type id of the editor of a terminal shown as an editor (`TerminalEditorInput.ID`). */
export const TERMINAL_EDITOR_TYPE_ID = 'workbench.editors.terminal';

/** The type id of the editor of a webview panel (`WebviewInput.typeId`); custom editors have their own. */
export const WEBVIEW_EDITOR_TYPE_ID = 'workbench.editors.webviewInput';

/** What the workbench prefixes the view type of a webview panel of an extension with. */
const EXTENSION_WEBVIEW_VIEW_TYPE_PREFIX = 'mainThreadWebview-';

/** What the Agent Dock needs to know of an editor to decide whether it belongs there. */
export interface IAgentDockEditorDescriptor {
	readonly typeId: string;
	/** The view type of a webview panel, as the workbench has it. */
	readonly viewType?: string;
}

/**
 * Whether `editor` is a webview panel of an extension whose view type is one of `webviews`, as an extension gives it to
 * `createWebviewPanel`.
 */
export function isAgentDockWebview(editor: IAgentDockEditorDescriptor, webviews: readonly string[]): boolean {
	if (editor.typeId !== WEBVIEW_EDITOR_TYPE_ID || !editor.viewType?.startsWith(EXTENSION_WEBVIEW_VIEW_TYPE_PREFIX)) {
		return false;
	}

	return webviews.includes(editor.viewType.substring(EXTENSION_WEBVIEW_VIEW_TYPE_PREFIX.length));
}

/** Whether `editor` may stay in the Agent Dock: a terminal, or one of the `webviews` panels. */
export function isAgentDockEditor(editor: IAgentDockEditorDescriptor, webviews: readonly string[]): boolean {
	return editor.typeId === TERMINAL_EDITOR_TYPE_ID || isAgentDockWebview(editor, webviews);
}
