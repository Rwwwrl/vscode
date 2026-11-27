/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { IClipboardService } from '../../../../../platform/clipboard/common/clipboardService.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { WebviewInput } from '../../../webviewPanel/browser/webviewEditorInput.js';
import { getAgentDockPreviewLineRange, IAgentDockPreviewBlocks } from '../../common/agentDock/agentDockPreview.js';
import { isAgentDockMarkdownPreview, requestAgentDockPreviewBlocks } from '../agentDock/agentDockPreviewSelection.js';

/** The ids the Markdown preview's webviews have in the `webviewId` context key of their context menu. */
const MARKDOWN_PREVIEW_WEBVIEW_IDS = ['markdown.preview', 'vscode.markdown.preview.editor'];

/**
 * Copies the Markdown source of the blocks selected in a Markdown preview, such as the LaTeX of a formula or the rows of
 * a table, instead of their rendered text: whole blocks, as the preview knows only where each block starts.
 */
class CopyOriginalTextAction extends Action2 {

	static readonly ID = 'vsade.markdownPreview.copyOriginalText';

	constructor() {
		super({
			id: CopyOriginalTextAction.ID,
			title: localize2('markdownPreview.copyOriginalText', "Copy Original Text"),
			category: localize2('markdownPreview.category', "Markdown"),
			f1: true,
			menu: {
				id: MenuId.WebviewContext,
				group: '5_cutcopypaste',
				order: 2.5, // after Copy
				// Images have a menu of their own
				when: ContextKeyExpr.and(
					ContextKeyExpr.or(...MARKDOWN_PREVIEW_WEBVIEW_IDS.map(id => ContextKeyExpr.equals('webviewId', id))),
					ContextKeyExpr.not('preventDefaultContextMenuItems'),
				),
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const textModelService = accessor.get(ITextModelService);
		const clipboardService = accessor.get(IClipboardService);
		const notificationService = accessor.get(INotificationService);

		for (const preview of this.getPreviews(editorService)) {
			const blocks = await requestAgentDockPreviewBlocks(preview);
			const text = blocks && await this.getSourceText(textModelService, blocks);
			if (text !== undefined) {
				await clipboardService.writeText(text);
				return;
			}
		}

		notificationService.info(localize('markdownPreview.copyOriginalTextNothing', "Select text in a Markdown preview to copy its original Markdown."));
	}

	/** The visible Markdown previews, the one with the focus first, as the one of a context menu has it, then the active one. */
	private getPreviews(editorService: IEditorService): WebviewInput[] {
		const previews = editorService.visibleEditors.filter(isAgentDockMarkdownPreview);
		const active = editorService.activeEditor;
		const rank = (preview: WebviewInput) => preview.webview.isFocused ? 0 : preview === active ? 1 : 2;
		return previews.sort((a, b) => rank(a) - rank(b));
	}

	/** The source lines of `blocks`; nothing when the preview shows another version of its file. */
	private async getSourceText(textModelService: ITextModelService, blocks: IAgentDockPreviewBlocks): Promise<string | undefined> {
		let source: URI;
		try {
			source = URI.parse(blocks.source);
		} catch {
			return undefined;
		}

		const reference = await textModelService.createModelReference(source);
		try {
			const model = reference.object.textEditorModel;
			const range = getAgentDockPreviewLineRange(blocks, model.getLineCount(), lineNumber => model.getLineContent(lineNumber));
			if (!range) {
				return undefined;
			}

			return model.getValueInRange({ ...range, startColumn: 1, endColumn: model.getLineMaxColumn(range.endLineNumber) });
		} finally {
			reference.dispose();
		}
	}
}

registerAction2(CopyOriginalTextAction);
