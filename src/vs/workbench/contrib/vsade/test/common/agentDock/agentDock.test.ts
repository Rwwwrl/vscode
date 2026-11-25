/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { CUSTOM_EDITOR_TYPE_ID, IAgentDockEditorDescriptor, isAgentDockEditor, isAgentDockWebview, TERMINAL_EDITOR_TYPE_ID, WEBVIEW_EDITOR_TYPE_ID } from '../../../common/agentDock/agentDock.js';

suite('Agent Dock', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const webviews = ['claudeVSCodePanel', 'chatgpt.conversationEditor'];

	const editors: Record<string, IAgentDockEditorDescriptor> = {
		terminal: { typeId: TERMINAL_EDITOR_TYPE_ID },
		claudeCode: { typeId: WEBVIEW_EDITOR_TYPE_ID, viewType: 'mainThreadWebview-claudeVSCodePanel' },
		otherWebview: { typeId: WEBVIEW_EDITOR_TYPE_ID, viewType: 'mainThreadWebview-claudePlanPreview' },
		workbenchWebview: { typeId: WEBVIEW_EDITOR_TYPE_ID, viewType: 'claudeVSCodePanel' },
		codex: { typeId: CUSTOM_EDITOR_TYPE_ID, viewType: 'chatgpt.conversationEditor' },
		otherCustomEditor: { typeId: CUSTOM_EDITOR_TYPE_ID, viewType: 'imagePreview.previewEditor' },
		prefixedCustomEditor: { typeId: CUSTOM_EDITOR_TYPE_ID, viewType: 'mainThreadWebview-chatgpt.conversationEditor' },
		file: { typeId: 'workbench.editors.files.fileEditorInput' },
	};

	test('holds terminals and the listed webview panels and custom editors of extensions only', () => {
		const result = Object.fromEntries(Object.entries(editors).map(([name, editor]) => [name, { editor: isAgentDockEditor(editor, webviews), webview: isAgentDockWebview(editor, webviews) }]));

		assert.deepStrictEqual(result, {
			terminal: { editor: true, webview: false },
			claudeCode: { editor: true, webview: true },
			otherWebview: { editor: false, webview: false },
			workbenchWebview: { editor: false, webview: false },
			codex: { editor: true, webview: true },
			otherCustomEditor: { editor: false, webview: false },
			prefixedCustomEditor: { editor: false, webview: false },
			file: { editor: false, webview: false },
		});
	});

	test('holds terminals only when no webview panel is listed', () => {
		assert.deepStrictEqual([isAgentDockEditor(editors.terminal, []), isAgentDockEditor(editors.claudeCode, [])], [true, false]);
	});
});
