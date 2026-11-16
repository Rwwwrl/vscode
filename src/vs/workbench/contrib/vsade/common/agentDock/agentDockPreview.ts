/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * The selection badge of the Markdown preview (`extensions/markdown-language-features/preview-src/vsadeSelectionBadge.ts`)
 * and the workbench talk with these messages, over the messages of the preview's webview. Keep the two in sync.
 *
 * A native drag cannot leave the preview: the browser engine does not let a drag that starts in a frame of another
 * process drop on the window around it. The badge drags with the pointer captured instead, which keeps the pointer's
 * events in the preview also outside of it, and posts them to the workbench, which places and drops the drag.
 */

/** The view types of the webviews of the Markdown preview: beside an editor, and as the editor of a file. */
export const MARKDOWN_PREVIEW_VIEW_TYPES: readonly string[] = ['mainThreadWebview-markdown.preview', 'vscode.markdown.preview.editor'];

/** From the preview: its script started, and wants to know whether to show the badge. */
export const AGENT_DOCK_PREVIEW_READY_MESSAGE = 'vsade.agentDock.previewReady';

/** From the preview: a step of a drag of its badge. */
export const AGENT_DOCK_PREVIEW_DRAG_MESSAGE = 'vsade.agentDock.selectionDrag';

/** To the preview: whether to show the badge, and its label. */
export const AGENT_DOCK_PREVIEW_BADGE_MESSAGE = 'vsade.agentDock.selectionBadge';

/** To the preview: asks for its selection, which it posts back with {@link AGENT_DOCK_PREVIEW_SELECTION_MESSAGE}. */
export const AGENT_DOCK_PREVIEW_SELECTION_REQUEST_MESSAGE = 'vsade.agentDock.selectionRequest';

/** From the preview: its selection, for the request with the same `requestId`; without blocks when nothing is selected. */
export const AGENT_DOCK_PREVIEW_SELECTION_MESSAGE = 'vsade.agentDock.selection';

/** The blocks of the source that a selection of the preview spans. */
export interface IAgentDockPreviewBlocks {
	/** The Markdown file the preview shows. */
	readonly source: string;
	/** The source lines, from 0, where the first and the last block of the selection start. */
	readonly startLine: number;
	readonly endBlockLine: number;
	/** Where the block after the last one of the selection starts, if one does. */
	readonly nextBlockLine: number | undefined;
}

/** A step of a drag of the badge of the preview; coordinates are in the viewport of the preview. */
export type AgentDockPreviewDragMessage =
	| ({ readonly phase: 'start'; readonly x: number; readonly y: number } & IAgentDockPreviewBlocks)
	| { readonly phase: 'move' | 'end'; readonly x: number; readonly y: number }
	| { readonly phase: 'cancel' };

/** A message of the preview, unless it is not one of the dock. */
export type AgentDockPreviewMessage =
	| { readonly type: 'ready' }
	| { readonly type: 'drag'; readonly drag: AgentDockPreviewDragMessage }
	| { readonly type: 'selection'; readonly requestId: number; readonly blocks: IAgentDockPreviewBlocks | undefined };

function isNumber(value: unknown): value is number {
	return typeof value === 'number' && Number.isFinite(value);
}

/** The blocks that `data`, a message of the preview, carries, if it carries them all. */
function parseBlocks(data: { readonly [key: string]: unknown }): IAgentDockPreviewBlocks | undefined {
	if (typeof data.source !== 'string' || !Number.isInteger(data.startLine) || !Number.isInteger(data.endBlockLine)
		|| !(data.nextBlockLine === undefined || data.nextBlockLine === null || Number.isInteger(data.nextBlockLine))) {
		return undefined;
	}

	return {
		source: data.source,
		startLine: data.startLine as number,
		endBlockLine: data.endBlockLine as number,
		nextBlockLine: Number.isInteger(data.nextBlockLine) ? data.nextBlockLine as number : undefined,
	};
}

/** The message of the dock that `message`, posted by a preview, is, if any. */
export function parseAgentDockPreviewMessage(message: unknown): AgentDockPreviewMessage | undefined {
	if (!message || typeof message !== 'object') {
		return undefined;
	}

	const data = message as { readonly [key: string]: unknown };
	if (data.type === AGENT_DOCK_PREVIEW_READY_MESSAGE) {
		return { type: 'ready' };
	}

	if (data.type === AGENT_DOCK_PREVIEW_SELECTION_MESSAGE) {
		return Number.isInteger(data.requestId) ? { type: 'selection', requestId: data.requestId as number, blocks: parseBlocks(data) } : undefined;
	}

	if (data.type !== AGENT_DOCK_PREVIEW_DRAG_MESSAGE) {
		return undefined;
	}

	switch (data.phase) {
		case 'start': {
			const blocks = parseBlocks(data);
			return isNumber(data.x) && isNumber(data.y) && blocks ? { type: 'drag', drag: { phase: 'start', x: data.x, y: data.y, ...blocks } } : undefined;
		}
		case 'move':
		case 'end':
			return isNumber(data.x) && isNumber(data.y) ? { type: 'drag', drag: { phase: data.phase, x: data.x, y: data.y } } : undefined;
		case 'cancel':
			return { type: 'drag', drag: { phase: 'cancel' } };
		default:
			return undefined;
	}
}

/**
 * The lines of the Markdown file, from 1, that the blocks of a selection in its preview span: from the start of the first
 * block to the end of the last, which the preview does not know, so up to the line before the block after it, without
 * the blank lines between them. `lineCount` and `getLineContent` are of the file.
 */
export function getAgentDockPreviewLineRange(
	drag: Omit<IAgentDockPreviewBlocks, 'source'>,
	lineCount: number,
	getLineContent: (lineNumber: number) => string,
): { readonly startLineNumber: number; readonly endLineNumber: number } | undefined {
	const startLineNumber = drag.startLine + 1;
	const endBlockLineNumber = Math.max(startLineNumber, drag.endBlockLine + 1);
	if (startLineNumber < 1 || endBlockLineNumber > lineCount) {
		return undefined; // the preview shows another version of the file
	}

	let endLineNumber = drag.nextBlockLine !== undefined && drag.nextBlockLine >= endBlockLineNumber ? Math.min(drag.nextBlockLine, lineCount) : lineCount;
	while (endLineNumber > endBlockLineNumber && !getLineContent(endLineNumber).trim()) {
		endLineNumber--;
	}

	return { startLineNumber, endLineNumber };
}
