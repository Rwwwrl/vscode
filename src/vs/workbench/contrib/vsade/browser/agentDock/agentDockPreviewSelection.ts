/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, raceTimeout } from '../../../../../base/common/async.js';
import { Disposable, DisposableMap, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { WebviewInput } from '../../../webviewPanel/browser/webviewEditorInput.js';
import { AgentDockMarkdownPreviewFocusContext } from '../../common/agentDock/agentDock.js';
import { createAgentDockSelection, IAgentDockSelection } from '../../common/agentDock/agentDockDrop.js';
import { AGENT_DOCK_PREVIEW_SELECTION_REQUEST_MESSAGE, getAgentDockPreviewLineRange, IAgentDockPreviewBlocks, MARKDOWN_PREVIEW_VIEW_TYPES, parseAgentDockPreviewMessage } from '../../common/agentDock/agentDockPreview.js';

/** How long {@link requestAgentDockPreviewSelection} waits for the preview to answer. */
const SELECTION_REQUEST_TIMEOUT = 2_000;

let requestIdPool = 0;

/** Whether `editor` is a Markdown preview, beside an editor or as the editor of a file. */
export function isAgentDockMarkdownPreview(editor: EditorInput | undefined): editor is WebviewInput {
	return editor instanceof WebviewInput && !editor.isDisposed() && MARKDOWN_PREVIEW_VIEW_TYPES.includes(editor.viewType);
}

/**
 * The selection of whole lines of the Markdown file that the blocks of a selection in its preview span. Nothing when the
 * file is not open, or the preview shows another version of it.
 */
export function resolveAgentDockPreviewSelection(modelService: IModelService, blocks: IAgentDockPreviewBlocks): IAgentDockSelection | undefined {
	let source: URI;
	try {
		source = URI.parse(blocks.source);
	} catch {
		return undefined;
	}

	const model = modelService.getModel(source);
	if (!model) {
		return undefined;
	}

	const range = getAgentDockPreviewLineRange(blocks, model.getLineCount(), lineNumber => model.getLineContent(lineNumber));
	if (!range) {
		return undefined;
	}

	const fullRange = { ...range, startColumn: 1, endColumn: model.getLineMaxColumn(range.endLineNumber) };
	return createAgentDockSelection(source, fullRange, model.getValueInRange(fullRange), lineNumber => model.getLineContent(lineNumber));
}

/** Asks `preview` for its selection; nothing when nothing is selected, or the preview does not answer in time. */
export async function requestAgentDockPreviewSelection(preview: WebviewInput, modelService: IModelService): Promise<IAgentDockSelection | undefined> {
	const requestId = requestIdPool++;
	const answer = new DeferredPromise<IAgentDockPreviewBlocks | undefined>();

	const store = new DisposableStore();
	try {
		store.add(preview.webview.onMessage(e => {
			const message = parseAgentDockPreviewMessage(e.message);
			if (message?.type === 'selection' && message.requestId === requestId) {
				answer.complete(message.blocks);
			}
		}));

		if (!await preview.webview.postMessage({ type: AGENT_DOCK_PREVIEW_SELECTION_REQUEST_MESSAGE, requestId })) {
			return undefined;
		}

		const blocks = await raceTimeout(answer.p, SELECTION_REQUEST_TIMEOUT);
		return blocks ? resolveAgentDockPreviewSelection(modelService, blocks) : undefined;
	} finally {
		store.dispose();
	}
}

/**
 * Sets `vsade.agentDock.markdownPreviewFocus` while a Markdown preview has the focus, for keybindings of
 * `vsade.agentDock.insertSelection` there.
 */
export class AgentDockMarkdownPreviewFocusTracker extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'vsade.agentDock.markdownPreviewFocus';

	private readonly previews = this._register(new DisposableMap<WebviewInput>());
	private readonly focusContext: IContextKey<boolean>;
	private focused: WebviewInput | undefined;

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IContextKeyService contextKeyService: IContextKeyService,
	) {
		super();

		this.focusContext = AgentDockMarkdownPreviewFocusContext.bindTo(contextKeyService);

		this.trackPreviews();
		this._register(this.editorService.onDidVisibleEditorsChange(() => this.trackPreviews()));
	}

	private trackPreviews(): void {
		for (const editor of this.editorService.visibleEditors) {
			if (!isAgentDockMarkdownPreview(editor) || this.previews.has(editor)) {
				continue;
			}

			const store = new DisposableStore();
			store.add(editor.webview.onDidFocus(() => this.setFocused(editor)));
			store.add(editor.webview.onDidBlur(() => {
				if (this.focused === editor) {
					this.setFocused(undefined);
				}
			}));
			store.add(editor.onWillDispose(() => {
				if (this.focused === editor) {
					this.setFocused(undefined);
				}
				this.previews.deleteAndDispose(editor);
			}));
			this.previews.set(editor, store);

			if (editor.webview.isFocused) {
				this.setFocused(editor);
			}
		}
	}

	private setFocused(preview: WebviewInput | undefined): void {
		this.focused = preview;
		this.focusContext.set(!!preview);
	}
}
