/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { AGENT_DOCK_PREVIEW_DRAG_MESSAGE, AGENT_DOCK_PREVIEW_READY_MESSAGE, AGENT_DOCK_PREVIEW_SELECTION_MESSAGE, getAgentDockPreviewLineRange, parseAgentDockPreviewMessage } from '../../../common/agentDock/agentDockPreview.js';

suite('Agent Dock Preview', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('reads the messages of the preview, and nothing else', () => {
		const start = { type: AGENT_DOCK_PREVIEW_DRAG_MESSAGE, phase: 'start', x: 1, y: 2, source: 'file:///repo/README.md', startLine: 2, endBlockLine: 4, nextBlockLine: null };

		assert.deepStrictEqual([
			parseAgentDockPreviewMessage({ type: AGENT_DOCK_PREVIEW_READY_MESSAGE }),
			parseAgentDockPreviewMessage(start),
			parseAgentDockPreviewMessage({ ...start, nextBlockLine: 6 }),
			parseAgentDockPreviewMessage({ ...start, startLine: '2' }),
			parseAgentDockPreviewMessage({ type: AGENT_DOCK_PREVIEW_DRAG_MESSAGE, phase: 'move', x: 3, y: 4 }),
			parseAgentDockPreviewMessage({ type: AGENT_DOCK_PREVIEW_DRAG_MESSAGE, phase: 'end', x: 3 }),
			parseAgentDockPreviewMessage({ type: AGENT_DOCK_PREVIEW_DRAG_MESSAGE, phase: 'cancel' }),
			parseAgentDockPreviewMessage({ type: AGENT_DOCK_PREVIEW_SELECTION_MESSAGE, requestId: 7, source: 'file:///repo/README.md', startLine: 2, endBlockLine: 4, nextBlockLine: 6 }),
			parseAgentDockPreviewMessage({ type: AGENT_DOCK_PREVIEW_SELECTION_MESSAGE, requestId: 8 }),
			parseAgentDockPreviewMessage({ type: AGENT_DOCK_PREVIEW_SELECTION_MESSAGE, startLine: 2 }),
			parseAgentDockPreviewMessage({ type: 'didClick', line: 3 }),
			parseAgentDockPreviewMessage('text'),
		], [
			{ type: 'ready' },
			{ type: 'drag', drag: { phase: 'start', x: 1, y: 2, source: 'file:///repo/README.md', startLine: 2, endBlockLine: 4, nextBlockLine: undefined } },
			{ type: 'drag', drag: { phase: 'start', x: 1, y: 2, source: 'file:///repo/README.md', startLine: 2, endBlockLine: 4, nextBlockLine: 6 } },
			undefined,
			{ type: 'drag', drag: { phase: 'move', x: 3, y: 4 } },
			undefined,
			{ type: 'drag', drag: { phase: 'cancel' } },
			{ type: 'selection', requestId: 7, blocks: { source: 'file:///repo/README.md', startLine: 2, endBlockLine: 4, nextBlockLine: 6 } },
			{ type: 'selection', requestId: 8, blocks: undefined },
			undefined,
			undefined,
			undefined,
		]);
	});

	test('spans the selected blocks of the source, without the blank lines after them', () => {
		const lines = ['# Title', '', 'First line of a paragraph', 'second line', '', '', '- item', ''];
		const getLineContent = (lineNumber: number) => lines[lineNumber - 1];

		assert.deepStrictEqual([
			getAgentDockPreviewLineRange({ startLine: 0, endBlockLine: 0, nextBlockLine: 2 }, lines.length, getLineContent),
			getAgentDockPreviewLineRange({ startLine: 2, endBlockLine: 2, nextBlockLine: 6 }, lines.length, getLineContent),
			getAgentDockPreviewLineRange({ startLine: 0, endBlockLine: 6, nextBlockLine: undefined }, lines.length, getLineContent),
			getAgentDockPreviewLineRange({ startLine: 2, endBlockLine: 9, nextBlockLine: undefined }, lines.length, getLineContent),
		], [
			{ startLineNumber: 1, endLineNumber: 1 },
			{ startLineNumber: 3, endLineNumber: 4 },
			{ startLineNumber: 1, endLineNumber: 7 },
			undefined,
		]);
	});
});
