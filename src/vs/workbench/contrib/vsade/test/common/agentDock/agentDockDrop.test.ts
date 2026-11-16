/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { TERMINAL_EDITOR_TYPE_ID, WEBVIEW_EDITOR_TYPE_ID } from '../../../common/agentDock/agentDock.js';
import { AgentDockDropTargetKind, createAgentDockSelection, createClaudeCodeInsertAtMentionMessage, getAgentDockDropTargetKind, getAgentDockMention, getAgentDockRelativePath, getAgentDockSelectionMention, getAgentDockTerminalPath, IAgentDockDrag, IAgentDockSelection, isAgentDockFileDrag, locateAgentDockSelection, normalizeAgentDockDropResources, parseAgentDockSelection, serializeAgentDockSelection } from '../../../common/agentDock/agentDockDrop.js';

suite('Agent Dock Drop', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('takes files into terminals and Claude Code only', () => {
		assert.deepStrictEqual([
			getAgentDockDropTargetKind({ typeId: TERMINAL_EDITOR_TYPE_ID }),
			getAgentDockDropTargetKind({ typeId: WEBVIEW_EDITOR_TYPE_ID, viewType: 'mainThreadWebview-claudeVSCodePanel' }),
			getAgentDockDropTargetKind({ typeId: WEBVIEW_EDITOR_TYPE_ID, viewType: 'mainThreadWebview-otherAgentPanel' }),
			getAgentDockDropTargetKind({ typeId: 'workbench.editors.files.fileEditorInput' }),
			getAgentDockDropTargetKind(undefined),
		], ['terminal', 'claudeCode', undefined, undefined, undefined]);
	});

	test('takes drags of files and selections, but not of groups, terminals or tabs of the dock', () => {
		const files: IAgentDockDrag = { carriesResources: true, carriesSelection: false, draggingGroup: false, draggingTerminals: false, draggingDockEditor: false };
		const selection: IAgentDockDrag = { ...files, carriesResources: false, carriesSelection: true };

		assert.deepStrictEqual([
			isAgentDockFileDrag(files),
			isAgentDockFileDrag({ ...files, carriesResources: false }),
			isAgentDockFileDrag({ ...files, draggingGroup: true }),
			isAgentDockFileDrag({ ...files, draggingTerminals: true }),
			isAgentDockFileDrag({ ...files, draggingDockEditor: true }),
			isAgentDockFileDrag(selection),
		], [true, false, false, false, false, true]);
	});

	test('drops files, the working tree file of a git resource, and each once', () => {
		const file = URI.file('/repo/src/a.ts');
		const staged = URI.from({ scheme: 'git', path: '/repo/src/b.ts.git', query: JSON.stringify({ path: '/repo/src/b.ts', ref: '' }) });

		const result = normalizeAgentDockDropResources([
			file,
			file.with({ fragment: 'L3-5' }),
			staged,
			URI.from({ scheme: 'git', path: '/repo/src/c.ts', query: 'not json' }),
			URI.from({ scheme: 'untitled', path: 'Untitled-1' }),
			URI.from({ scheme: 'vscode-terminal', path: '/1/2' }),
			URI.file('/repo/docs'),
		]);

		assert.deepStrictEqual(result.map(resource => resource.toString()), [
			'file:///repo/src/a.ts',
			'file:///repo/src/b.ts',
			'file:///repo/docs',
		]);
	});

	test('mentions paths as Claude Code writes them', () => {
		const folder = { uri: URI.file('/repo'), name: 'repo' };
		const file = URI.file('/repo/src/a.ts');

		assert.deepStrictEqual([
			getAgentDockRelativePath(file, folder, false),
			getAgentDockRelativePath(file, folder, true),
			getAgentDockRelativePath(URI.file('/elsewhere/b.ts'), undefined, false),
			getAgentDockRelativePath(folder.uri, folder, false),
			getAgentDockMention('src/a.ts'),
			getAgentDockMention('src/my file.ts'),
			getAgentDockMention('src/#1.ts'),
			getAgentDockMention('src/"a".ts'),
		], [
			'src/a.ts',
			'repo/src/a.ts',
			URI.file('/elsewhere/b.ts').fsPath,
			folder.uri.fsPath,
			'@src/a.ts',
			'@src/my file.ts',
			undefined,
			undefined,
		]);
	});

	test('drags the selected lines of a file or of a read-only version of one, without a last line that nothing of is selected', () => {
		const file = URI.file('/repo/src/a.ts');
		const staged = URI.from({ scheme: 'git', path: '/repo/src/a.ts', query: JSON.stringify({ path: '/repo/src/a.ts', ref: '' }) });
		const getLineContent = (lineNumber: number) => `line ${lineNumber}`;
		const summarize = (selection: IAgentDockSelection | undefined) => selection && [selection.resource.toString(), selection.startLineNumber, selection.endLineNumber, selection.lines];

		assert.deepStrictEqual([
			createAgentDockSelection(file, { startLineNumber: 3, startColumn: 5, endLineNumber: 5, endColumn: 2 }, 'text', getLineContent),
			createAgentDockSelection(file, { startLineNumber: 3, startColumn: 1, endLineNumber: 5, endColumn: 1 }, 'text', getLineContent),
			createAgentDockSelection(staged, { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 4 }, 'tex', getLineContent),
			createAgentDockSelection(URI.from({ scheme: 'untitled', path: 'Untitled-1' }), { startLineNumber: 3, startColumn: 1, endLineNumber: 3, endColumn: 4 }, 'tex', getLineContent),
		].map(summarize), [
			['file:///repo/src/a.ts', 3, 5, ['line 3', 'line 4', 'line 5']],
			['file:///repo/src/a.ts', 3, 4, ['line 3', 'line 4']],
			['file:///repo/src/a.ts', 3, 3, ['line 3']],
			undefined,
		]);
	});

	test('carries a selection on the data of a drag', () => {
		const selection = createAgentDockSelection(URI.file('/repo/src/my file.ts'), { startLineNumber: 3, startColumn: 1, endLineNumber: 4, endColumn: 4 }, 'line\n\tli', lineNumber => lineNumber === 3 ? 'line' : '\tline')!;
		const parsed = parseAgentDockSelection(serializeAgentDockSelection(selection));

		assert.deepStrictEqual([
			parsed && { ...parsed, resource: parsed.resource.toString() },
			parseAgentDockSelection('not json'),
			parseAgentDockSelection(JSON.stringify({ resource: 'file:///a.ts', startLineNumber: '3', endLineNumber: 5, text: '', lines: [] })),
			parseAgentDockSelection(JSON.stringify({ resource: 'file:///a.ts', startLineNumber: 3, endLineNumber: 5, text: '' })),
		], [
			{ ...selection, resource: selection.resource.toString() },
			undefined,
			undefined,
			undefined,
		]);
	});

	test('finds the selected lines in the file on disk, nearest to where they were selected', () => {
		const selection = (startLineNumber: number, lines: string[]): IAgentDockSelection => ({ resource: URI.file('/repo/a.ts'), startLineNumber, endLineNumber: startLineNumber + lines.length - 1, text: '', lines });
		const content = ['a', 'b', 'c', 'x', 'b', 'c'].join('\r\n');

		assert.deepStrictEqual([
			locateAgentDockSelection(content, selection(2, ['b', 'c'])),
			locateAgentDockSelection(content, selection(4, ['b', 'c'])),
			locateAgentDockSelection(content, selection(1, ['x'])),
			locateAgentDockSelection(content, selection(1, ['gone'])),
		], [
			{ startLineNumber: 2, endLineNumber: 3 },
			{ startLineNumber: 5, endLineNumber: 6 },
			{ startLineNumber: 4, endLineNumber: 4 },
			undefined,
		]);
	});

	test('mentions selected lines as Claude Code writes them in its panel and on its command line', () => {
		const lines = { startLineNumber: 3, endLineNumber: 5 };
		const line = { startLineNumber: 7, endLineNumber: 7 };

		assert.deepStrictEqual([
			getAgentDockSelectionMention('src/a.ts', lines, AgentDockDropTargetKind.ClaudeCode),
			getAgentDockSelectionMention('src/a.ts', line, AgentDockDropTargetKind.ClaudeCode),
			getAgentDockSelectionMention('src/a.ts', lines, AgentDockDropTargetKind.Terminal),
			getAgentDockSelectionMention('src/a.ts', line, AgentDockDropTargetKind.Terminal),
			getAgentDockSelectionMention('src/#1.ts', lines, AgentDockDropTargetKind.Terminal),
		], ['@src/a.ts#3-5', '@src/a.ts#7', '@src/a.ts#L3-5', '@src/a.ts#L7', undefined]);
	});

	test('refers to a file from a terminal relative to its working directory', () => {
		const file = URI.file('/repo/src/a.ts');

		assert.deepStrictEqual([
			getAgentDockTerminalPath(file, URI.file('/repo')),
			getAgentDockTerminalPath(file, URI.file('/repo/src')),
			getAgentDockTerminalPath(file, URI.file('/elsewhere')),
			getAgentDockTerminalPath(file, undefined),
		], ['src/a.ts', 'a.ts', file.fsPath, file.fsPath]);
	});

	test('inserts a mention with the message of Claude Code\'s own command', () => {
		assert.deepStrictEqual(createClaudeCodeInsertAtMentionMessage('@src/a.ts'), {
			type: 'from-extension',
			message: { type: 'request', channelId: '', requestId: '', request: { type: 'insert_at_mention', text: '@src/a.ts' } },
		});
	});
});
