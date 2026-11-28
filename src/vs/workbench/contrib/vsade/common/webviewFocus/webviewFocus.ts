/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { IContextKey, IContextKeyService, RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';

/**
 * Set in the scoped context of a webview while the key it forwards was typed into an editable element (a text input, a
 * text area, a select or contenteditable content), such as for a keybinding of a printable key that must not fire
 * while typing into an extension's webview (Claude Code, Codex).
 */
export const WebviewEditableFocusContext = new RawContextKey<boolean>('vsade.webviewEditableFocus', false, localize('vsade.webviewEditableFocus', "Whether the key forwarded by a webview was typed into an editable element of it"));

const contextKeys = new WeakMap<IContextKeyService, IContextKey<boolean>>();

/**
 * Updates {@link WebviewEditableFocusContext} in the scoped context of a webview for a key event it forwards.
 * A webview may move to another scoped context service over its lifetime, so the key is bound once per service.
 */
export function updateWebviewEditableFocus(contextKeyService: IContextKeyService | undefined, editable: boolean | undefined): void {
	if (!contextKeyService) {
		return;
	}
	let contextKey = contextKeys.get(contextKeyService);
	if (!contextKey) {
		contextKey = WebviewEditableFocusContext.bindTo(contextKeyService);
		contextKeys.set(contextKeyService, contextKey);
	}
	contextKey.set(!!editable);
}
