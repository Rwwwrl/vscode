/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { ContextKeyService } from '../../../../../../platform/contextkey/browser/contextKeyService.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { updateWebviewEditableFocus, WebviewEditableFocusContext } from '../../../common/webviewFocus/webviewFocus.js';

suite('vsade webviewEditableFocus', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	test('sets the key in the scoped context of the webview only', () => {
		const root = store.add(new ContextKeyService(new TestConfigurationService()));
		const first = store.add(root.createScoped(document.createElement('div')));
		const second = store.add(root.createScoped(document.createElement('div')));
		const key = WebviewEditableFocusContext.key;
		const read = () => [root.getContextKeyValue(key), first.getContextKeyValue(key), second.getContextKeyValue(key)];

		const steps: unknown[] = [];
		updateWebviewEditableFocus(first, true);
		steps.push(read());
		updateWebviewEditableFocus(second, false);
		steps.push(read());
		updateWebviewEditableFocus(first, undefined);
		steps.push(read());
		updateWebviewEditableFocus(undefined, true);
		steps.push(read());

		assert.deepStrictEqual(steps, [
			[undefined, true, undefined],
			[undefined, true, false],
			[undefined, false, false],
			[undefined, false, false],
		]);
	});
});
