/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../../base/common/network.js';
import { sep } from '../../../../../base/common/path.js';
import { basename, isEqualOrParent, relativePath } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IRange } from '../../../../../editor/common/core/range.js';
import { parseGitResource } from '../gitResource.js';
import { CLAUDE_CODE_WEBVIEW_VIEW_TYPE, CODEX_CUSTOM_EDITOR_VIEW_TYPE, IAgentDockEditorDescriptor, isAgentDockWebview, TERMINAL_EDITOR_TYPE_ID } from './agentDock.js';

/** The tabs of the Agent Dock that take dropped files. */
export const enum AgentDockDropTargetKind {
	/** Takes the paths, typed into the terminal. */
	Terminal = 'terminal',
	/** Takes an @-mention of each file, inserted into the chat input. */
	ClaudeCode = 'claudeCode',
	/** Takes each file as context of the message being written. */
	Codex = 'codex',
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

	if (isAgentDockWebview(editor, [CODEX_CUSTOM_EDITOR_VIEW_TYPE])) {
		return AgentDockDropTargetKind.Codex;
	}

	return undefined;
}

/** What the dock needs to know of a drag to decide whether its files go into the tab under it. */
export interface IAgentDockDrag {
	/** Whether the drag carries resources, such as files from the Explorer or an editor tab. */
	readonly carriesResources: boolean;
	/** Whether the drag carries the selection of an editor, from its badge. */
	readonly carriesSelection: boolean;
	/** Whether an editor group is dragged. */
	readonly draggingGroup: boolean;
	/** Whether terminals are dragged, such as from the list of terminals. */
	readonly draggingTerminals: boolean;
	/** Whether a dragged editor is one the dock holds, such as a terminal or an agent panel. */
	readonly draggingDockEditor: boolean;
}

/**
 * Whether the files or the selection of a drag go into the tab under it. Groups, terminals and the dock's own editors keep
 * the workbench's handling: they move or split groups.
 */
export function isAgentDockFileDrag(drag: IAgentDockDrag): boolean {
	if (drag.carriesSelection) {
		return true;
	}

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

	return parseGitResource(resource)?.file;
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

/** The type of the data of a drag of the selection of an editor, which its badge starts. */
export const AGENT_DOCK_SELECTION_DATA_TRANSFER = 'application/vnd.code.vsade.selection';

/** The selection of an editor that is dragged into the dock. */
export interface IAgentDockSelection {
	/**
	 * The file on disk that the selection refers to: the file of the editor, or the file in the working tree that a
	 * read-only version of it stands for, such as the staged version in a diff of the Source Control view.
	 */
	readonly resource: URI;
	/** The first and the last line of the selection, from 1, in the editor it was made in. */
	readonly startLineNumber: number;
	readonly endLineNumber: number;
	/** The selected text. */
	readonly text: string;
	/** The whole of the lines of the selection, which find them in the file on disk when their numbers differ there. */
	readonly lines: readonly string[];
}

/**
 * The selection `range` of the editor of `resource` with the `text` in it; `getLineContent` gives the text of a line of
 * the editor. A selection that ends at the start of a line ends with the line before: nothing of that last line is
 * selected. Nothing for an editor of anything but a file (see {@link normalizeAgentDockDropResources}).
 */
export function createAgentDockSelection(resource: URI, range: IRange, text: string, getLineContent: (lineNumber: number) => string): IAgentDockSelection | undefined {
	const [file] = normalizeAgentDockDropResources([resource]);
	if (!file) {
		return undefined;
	}

	const endsBeforeLine = range.endColumn === 1 && range.endLineNumber > range.startLineNumber;
	const endLineNumber = endsBeforeLine ? range.endLineNumber - 1 : range.endLineNumber;
	const lines: string[] = [];
	for (let lineNumber = range.startLineNumber; lineNumber <= endLineNumber; lineNumber++) {
		lines.push(getLineContent(lineNumber));
	}

	return { resource: file, startLineNumber: range.startLineNumber, endLineNumber, text, lines };
}

/**
 * Where the lines of `selection` are in `content`, the text of its file on disk, for a reference to them: where they were
 * selected when they are still there, such as from the file itself, saved; else where they are nearest to that, such as
 * from the staged version of a file that changed since, or from an editor with unsaved changes. Nothing when they are not
 * in the file, as a reference would point at other lines.
 */
export function locateAgentDockSelection(content: string, selection: IAgentDockSelection): { readonly startLineNumber: number; readonly endLineNumber: number } | undefined {
	const fileLines = content.split(/\r\n|\r|\n/);
	const count = selection.lines.length;
	const matchesAt = (index: number) => {
		for (let offset = 0; offset < count; offset++) {
			if (fileLines[index + offset] !== selection.lines[offset]) {
				return false;
			}
		}
		return true;
	};

	const selectedIndex = selection.startLineNumber - 1;
	let bestIndex: number | undefined;
	for (let index = 0; index + count <= fileLines.length; index++) {
		if (matchesAt(index) && (bestIndex === undefined || Math.abs(index - selectedIndex) < Math.abs(bestIndex - selectedIndex))) {
			bestIndex = index;
		}
	}

	return bestIndex === undefined ? undefined : { startLineNumber: bestIndex + 1, endLineNumber: bestIndex + count };
}

/** The data of a drag of `selection`, for {@link AGENT_DOCK_SELECTION_DATA_TRANSFER}. */
export function serializeAgentDockSelection(selection: IAgentDockSelection): string {
	return JSON.stringify({ ...selection, resource: selection.resource.toString() });
}

/** The selection of the data of a drag, unless the data is not of a selection. */
export function parseAgentDockSelection(data: string): IAgentDockSelection | undefined {
	try {
		const { resource, startLineNumber, endLineNumber, text, lines } = JSON.parse(data) as { [key: string]: unknown };
		if (typeof resource === 'string' && Number.isInteger(startLineNumber) && Number.isInteger(endLineNumber) && typeof text === 'string'
			&& Array.isArray(lines) && lines.every(line => typeof line === 'string')) {
			return { resource: URI.parse(resource), startLineNumber: startLineNumber as number, endLineNumber: endLineNumber as number, text, lines };
		}
	} catch {
		// not a selection
	}

	return undefined;
}

/**
 * The path of `resource` for the command line of Claude Code in a terminal: relative to `cwd`, the working directory of
 * the terminal, when the resource is in it; the absolute path otherwise.
 */
export function getAgentDockTerminalPath(resource: URI, cwd: URI | undefined): string {
	const relative = cwd && isEqualOrParent(resource, cwd) ? relativePath(cwd, resource) : undefined;
	return relative || resource.fsPath;
}

/**
 * The @-mention of the lines `range` in the file at `path` as Claude Code writes it, unless the path cannot be
 * mentioned (see {@link getAgentDockMention}): `@path#3-5` in the chat input of its panel, where its "Insert @-Mention"
 * command writes it, and `@path#L3-5` on its command line, in a terminal.
 */
export function getAgentDockSelectionMention(path: string, range: { readonly startLineNumber: number; readonly endLineNumber: number }, target: AgentDockDropTargetKind): string | undefined {
	const mention = getAgentDockMention(path);
	if (!mention) {
		return undefined;
	}

	const lines = range.startLineNumber === range.endLineNumber ? `${range.startLineNumber}` : `${range.startLineNumber}-${range.endLineNumber}`;
	return `${mention}#${target === AgentDockDropTargetKind.Terminal ? 'L' : ''}${lines}`;
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

/**
 * The message the Codex extension posts to a conversation for its "Add File to Codex Chat" and "Add to Codex Chat"
 * commands. The message is private to the extension: this is its shape in version 26.1120.50957.
 */
export interface ICodexAddContextFileMessage {
	readonly type: 'add-context-file';
	readonly file: {
		readonly label: string;
		readonly path: string;
		readonly fsPath: string;
		readonly startLine?: number;
		readonly endLine?: number;
	};
}

/** What {@link createCodexAddContextFileMessage} adds: a folder, or the lines of a file, from 1. */
export type CodexContextTarget =
	| { readonly kind: 'file' }
	| { readonly kind: 'folder' }
	| { readonly kind: 'lines'; readonly startLineNumber: number; readonly endLineNumber: number };

/**
 * The message that adds `resource` to the context of the message being written in a Codex conversation, as `target`
 * says. Codex tells a folder by the separator its path ends with.
 */
export function createCodexAddContextFileMessage(resource: URI, target: CodexContextTarget): ICodexAddContextFileMessage {
	const path = target.kind === 'folder' && !resource.fsPath.endsWith(sep) ? `${resource.fsPath}${sep}` : resource.fsPath;
	const file = { label: basename(resource), path, fsPath: path };
	return { type: 'add-context-file', file: target.kind === 'lines' ? { ...file, startLine: target.startLineNumber, endLine: target.endLineNumber } : file };
}
