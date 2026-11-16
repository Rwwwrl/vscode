/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, isHTMLElement } from '../../../../../base/browser/dom.js';
import { CodeWindow } from '../../../../../base/browser/window.js';
import { onUnexpectedError } from '../../../../../base/common/errors.js';
import { Disposable, DisposableMap, DisposableStore, toDisposable } from '../../../../../base/common/lifecycle.js';
import { basename } from '../../../../../base/common/resources.js';
import { URI } from '../../../../../base/common/uri.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { WebviewInput } from '../../../webviewPanel/browser/webviewEditorInput.js';
import { AgentDockSelectionBadgeMode, AgentDockSettingId } from '../../common/agentDock/agentDock.js';
import { createAgentDockSelection, IAgentDockSelection } from '../../common/agentDock/agentDockDrop.js';
import { AGENT_DOCK_PREVIEW_BADGE_MESSAGE, AgentDockPreviewDragMessage, getAgentDockPreviewLineRange, MARKDOWN_PREVIEW_VIEW_TYPES, parseAgentDockPreviewMessage } from '../../common/agentDock/agentDockPreview.js';
import type { AgentDockDropController, IAgentDockDropTarget } from './agentDockDropController.js';

/** A drag of the badge of a Markdown preview that is under way. */
interface IPreviewDrag {
	readonly preview: WebviewInput;
	readonly selection: IAgentDockSelection;
	target: IAgentDockDropTarget | undefined;
}

/**
 * Drags selections of the Markdown preview into the tabs of the dock. The preview shows a badge next to a selection,
 * which drags with the pointer captured and posts each step of the drag (see `agentDockPreview.ts`): this places the
 * steps in the window, shows where the drag drops, and drops the selection as a drag of the badge of an editor does.
 */
export class AgentDockPreviewDrag extends Disposable {

	private readonly previews = this._register(new DisposableMap<WebviewInput>());

	private drag: IPreviewDrag | undefined;

	/** Follows the pointer during a drag, which shows nothing of its own outside of the preview. */
	private readonly ghost = $('.vsade-agent-dock-drag-ghost');

	constructor(
		private readonly dropController: AgentDockDropController,
		private readonly targetWindow: CodeWindow,
		@IEditorService private readonly editorService: IEditorService,
		@IModelService private readonly modelService: IModelService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();

		this._register(toDisposable(() => this.endDrag()));

		this.trackPreviews();
		this._register(this.editorService.onDidVisibleEditorsChange(() => this.trackPreviews()));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AgentDockSettingId.SelectionBadge)) {
				for (const preview of this.previews.keys()) {
					this.postBadgeState(preview);
				}
			}
		}));
	}

	//#region Previews

	/** Listens to the messages of each Markdown preview that shows, until it closes. */
	private trackPreviews(): void {
		for (const editor of this.editorService.visibleEditors) {
			if (!(editor instanceof WebviewInput) || this.previews.has(editor) || !MARKDOWN_PREVIEW_VIEW_TYPES.includes(editor.viewType)) {
				continue;
			}

			const store = new DisposableStore();
			store.add(editor.webview.onMessage(e => this.onMessage(editor, e.message)));
			store.add(editor.onWillDispose(() => this.previews.deleteAndDispose(editor)));
			this.previews.set(editor, store);

			this.postBadgeState(editor);
		}
	}

	/** Tells the preview whether to show its badge, which it does not until told. */
	private postBadgeState(preview: WebviewInput): void {
		const enabled = this.configurationService.getValue<string>(AgentDockSettingId.SelectionBadge) !== AgentDockSelectionBadgeMode.Off;
		const label = localize('agentDock.selectionBadge', "Drag to Agent");
		preview.webview.postMessage({ type: AGENT_DOCK_PREVIEW_BADGE_MESSAGE, enabled, label }).catch(onUnexpectedError);
	}

	private onMessage(preview: WebviewInput, message: unknown): void {
		const parsed = parseAgentDockPreviewMessage(message);
		if (parsed?.type === 'ready') {
			this.postBadgeState(preview);
		} else if (parsed?.type === 'drag') {
			this.onDrag(preview, parsed.drag);
		}
	}

	//#endregion

	//#region Drag

	private onDrag(preview: WebviewInput, message: AgentDockPreviewDragMessage): void {
		if (message.phase === 'start') {
			this.endDrag();

			const selection = this.resolveSelection(message);
			if (selection) {
				this.drag = { preview, selection, target: undefined };
				this.ghost.textContent = this.getGhostLabel(selection);
				this.targetWindow.document.body.appendChild(this.ghost);
				this.moveTo(message.x, message.y);
			}
			return;
		}

		if (this.drag?.preview !== preview) {
			return;
		}

		if (message.phase === 'move') {
			this.moveTo(message.x, message.y);
		} else if (message.phase === 'end') {
			this.moveTo(message.x, message.y);

			const { target, selection } = this.drag;
			this.endDrag();
			if (target) {
				this.dropController.dropSelection(target, selection).catch(onUnexpectedError);
			}
		} else {
			this.endDrag();
		}
	}

	/** The selection of whole lines of the Markdown file that the blocks of a selection in its preview span. */
	private resolveSelection(message: Extract<AgentDockPreviewDragMessage, { phase: 'start' }>): IAgentDockSelection | undefined {
		let source: URI;
		try {
			source = URI.parse(message.source);
		} catch {
			return undefined;
		}

		const model = this.modelService.getModel(source);
		if (!model) {
			return undefined;
		}

		const range = getAgentDockPreviewLineRange(message, model.getLineCount(), lineNumber => model.getLineContent(lineNumber));
		if (!range) {
			return undefined;
		}

		const fullRange = { ...range, startColumn: 1, endColumn: model.getLineMaxColumn(range.endLineNumber) };
		return createAgentDockSelection(source, fullRange, model.getValueInRange(fullRange), lineNumber => model.getLineContent(lineNumber));
	}

	/** Places the drag at `x`, `y` in the viewport of the preview it comes from. */
	private moveTo(x: number, y: number): void {
		const drag = this.drag;
		if (!drag) {
			return;
		}

		const origin = drag.preview.webview.container.getBoundingClientRect();
		const clientX = origin.left + x;
		const clientY = origin.top + y;

		this.ghost.style.left = `${clientX}px`;
		this.ghost.style.top = `${clientY}px`;

		const element = this.targetWindow.document.elementFromPoint(clientX, clientY);
		drag.target = isHTMLElement(element) ? this.dropController.findTargetAt(element, clientY) : undefined;
		if (drag.target) {
			this.dropController.showOverlay(drag.target.group, true);
		} else {
			this.dropController.hideOverlay();
		}
	}

	private endDrag(): void {
		if (this.drag) {
			this.drag = undefined;
			this.ghost.remove();
			this.dropController.hideOverlay();
		}
	}

	/** What the ghost of a drag says: the file and the lines that drop. */
	private getGhostLabel(selection: IAgentDockSelection): string {
		const lines = selection.startLineNumber === selection.endLineNumber ? `${selection.startLineNumber}` : `${selection.startLineNumber}-${selection.endLineNumber}`;
		return `@${basename(selection.resource)}#${lines}`;
	}

	//#endregion
}
