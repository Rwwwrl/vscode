/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IAgentDockEditorDescriptor, isAgentDockEditor, isAgentDockWebview, TERMINAL_EDITOR_TYPE_ID, WEBVIEW_EDITOR_TYPE_ID } from '../../../common/agentDock/agentDock.js';

suite('Agent Dock', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const webviews = ['claudeVSCodePanel'];

	const editors: Record<string, IAgentDockEditorDescriptor> = {
		terminal: { typeId: TERMINAL_EDITOR_TYPE_ID },
		claudeCode: { typeId: WEBVIEW_EDITOR_TYPE_ID, viewType: 'mainThreadWebview-claudeVSCodePanel' },
		otherWebview: { typeId: WEBVIEW_EDITOR_TYPE_ID, viewType: 'mainThreadWebview-claudePlanPreview' },
		workbenchWebview: { typeId: WEBVIEW_EDITOR_TYPE_ID, viewType: 'claudeVSCodePanel' },
		customEditor: { typeId: 'workbench.editors.webviewEditor', viewType: 'claudeVSCodePanel' },
		file: { typeId: 'workbench.editors.files.fileEditorInput' },
	};

	test('holds terminals and the listed webview panels of extensions only', () => {
		const result = Object.fromEntries(Object.entries(editors).map(([name, editor]) => [name, { editor: isAgentDockEditor(editor, webviews), webview: isAgentDockWebview(editor, webviews) }]));

		assert.deepStrictEqual(result, {
			terminal: { editor: true, webview: false },
			claudeCode: { editor: true, webview: true },
			otherWebview: { editor: false, webview: false },
			workbenchWebview: { editor: false, webview: false },
			customEditor: { editor: false, webview: false },
			file: { editor: false, webview: false },
		});
	});

	test('holds terminals only when no webview panel is listed', () => {
		assert.deepStrictEqual([isAgentDockEditor(editors.terminal, []), isAgentDockEditor(editors.claudeCode, [])], [true, false]);
	});
});
