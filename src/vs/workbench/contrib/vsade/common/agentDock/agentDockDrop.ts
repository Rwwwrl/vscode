/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../../base/common/network.js';
import { relativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { CLAUDE_CODE_WEBVIEW_VIEW_TYPE, IAgentDockEditorDescriptor, isAgentDockWebview, TERMINAL_EDITOR_TYPE_ID } from './agentDock.js';

/** The tabs of the Agent Dock that take dropped files. */
export const enum AgentDockDropTargetKind {
	/** Takes the paths, typed into the terminal. */
	Terminal = 'terminal',
	/** Takes an @-mention of each file, inserted into the chat input. */
	ClaudeCode = 'claudeCode',
}

/** What a dropped file goes into when `editor` is the active tab of a group of the dock, if anything. */
export function getAgentDockDropTargetKind(editor: IAgentDockEditorDescriptor | undefined): AgentDockDropTargetKind | undefined {
	if (!editor) {
		return undefined;
	}

	if (editor.typeId === TERMINAL_EDITOR_TYPE_ID) {
		return AgentDockDropTargetKind.Terminal;
	}

	if (isAgentDockWebview(editor, [CLAUDE_CODE_WEBVIEW_VIEW_TYPE])) {
		return AgentDockDropTargetKind.ClaudeCode;
	}

	return undefined;
}

/** What the dock needs to know of a drag to decide whether its files go into the tab under it. */
export interface IAgentDockDrag {
	/** Whether the drag carries resources, such as files from the Explorer or an editor tab. */
	readonly carriesResources: boolean;
	/** Whether an editor group is dragged. */
	readonly draggingGroup: boolean;
	/** Whether terminals are dragged, such as from the list of terminals. */
	readonly draggingTerminals: boolean;
	/** Whether a dragged editor is one the dock holds, such as a terminal or an agent panel. */
	readonly draggingDockEditor: boolean;
}

/**
 * Whether the files of a drag go into the tab under it. Groups, terminals and the dock's own editors keep the workbench's
 * handling: they move or split groups.
 */
export function isAgentDockFileDrag(drag: IAgentDockDrag): boolean {
	return drag.carriesResources && !drag.draggingGroup && !drag.draggingTerminals && !drag.draggingDockEditor;
}

/**
 * The files to insert for the resources of a drop, in order and once each: a resource of the git extension, such as the
 * modified side of a diff of staged changes, stands for its file in the working tree, and everything else that is not a
 * file, such as an untitled editor or a terminal, is left out.
 */
export function normalizeAgentDockDropResources(resources: readonly URI[]): URI[] {
	const result: URI[] = [];
	const seen = new Set<string>();
	for (const resource of resources) {
		const file = toFile(resource);
		if (!file) {
			continue;
		}

		const key = file.toString();
		if (!seen.has(key)) {
			seen.add(key);
			result.push(file);
		}
	}

	return result;
}

function toFile(resource: URI): URI | undefined {
	if (resource.scheme === Schemas.file) {
		return resource.with({ query: '', fragment: '' }); // a selection, such as of a dragged editor
	}

	if (resource.scheme === Schemas.git) {
		// The git extension keeps the path of the file in the query: its path can carry a suffix
		try {
			const { path } = JSON.parse(resource.query) as { path?: unknown };
			if (typeof path === 'string' && path) {
				return URI.file(path);
			}
		} catch {
			// not a resource of the git extension
		}
	}

	return undefined;
}

/** A workspace folder, as {@link getAgentDockRelativePath} needs it. */
export interface IAgentDockWorkspaceFolder {
	readonly uri: URI;
	readonly name: string;
}

/**
 * The path of `resource` as the Claude Code extension writes it in an @-mention, which is what
 * `vscode.workspace.asRelativePath` gives: relative to `folder`, the workspace folder of the resource, and starting with
 * the folder's name when `includeFolderName`, as in a workspace of several folders; the absolute path otherwise.
 */
export function getAgentDockRelativePath(resource: URI, folder: IAgentDockWorkspaceFolder | undefined, includeFolderName: boolean): string {
	const relative = folder ? relativePath(folder.uri, resource) : undefined;
	if (!folder || !relative) {
		return resource.fsPath;
	}

	return includeFolderName ? `${folder.name}/${relative}` : relative;
}

/**
 * The @-mention of `path` for Claude Code, unless it cannot be one: Claude Code would read a `#` as the start of a range
 * of lines and a `"` as the end of a quoted path.
 */
export function getAgentDockMention(path: string): string | undefined {
	if (!path || path.includes('#') || path.includes('"')) {
		return undefined;
	}

	return `@${path}`;
}

/**
 * The message the Claude Code extension posts to its panel for its "Insert @-Mention" command. The message is private to
 * the extension: this is its shape in version 2.1.325.
 */
export interface IClaudeCodeInsertAtMentionMessage {
	readonly type: 'from-extension';
	readonly message: {
		readonly type: 'request';
		readonly channelId: '';
		readonly requestId: '';
		readonly request: { readonly type: 'insert_at_mention'; readonly text: string };
	};
}

/** The message that inserts `text` into the chat input of a Claude Code panel and focuses it. */
export function createClaudeCodeInsertAtMentionMessage(text: string): IClaudeCodeInsertAtMentionMessage {
	return {
		type: 'from-extension',
		message: {
			type: 'request',
			channelId: '',
			requestId: '',
			request: { type: 'insert_at_mention', text },
		},
	};
}
