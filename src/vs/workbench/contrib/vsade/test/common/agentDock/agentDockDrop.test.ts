/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { TERMINAL_EDITOR_TYPE_ID, WEBVIEW_EDITOR_TYPE_ID } from '../../../common/agentDock/agentDock.js';
import { createClaudeCodeInsertAtMentionMessage, getAgentDockDropTargetKind, getAgentDockMention, getAgentDockRelativePath, IAgentDockDrag, isAgentDockFileDrag, normalizeAgentDockDropResources } from '../../../common/agentDock/agentDockDrop.js';

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

	test('takes drags of files, but not of groups, terminals or tabs of the dock', () => {
		const files: IAgentDockDrag = { carriesResources: true, draggingGroup: false, draggingTerminals: false, draggingDockEditor: false };

		assert.deepStrictEqual([
			isAgentDockFileDrag(files),
			isAgentDockFileDrag({ ...files, carriesResources: false }),
			isAgentDockFileDrag({ ...files, draggingGroup: true }),
			isAgentDockFileDrag({ ...files, draggingTerminals: true }),
			isAgentDockFileDrag({ ...files, draggingDockEditor: true }),
		], [true, false, false, false, false]);
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

	test('inserts a mention with the message of Claude Code\'s own command', () => {
		assert.deepStrictEqual(createClaudeCodeInsertAtMentionMessage('@src/a.ts'), {
			type: 'from-extension',
			message: { type: 'request', channelId: '', requestId: '', request: { type: 'insert_at_mention', text: '@src/a.ts' } },
		});
	});
});
