/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DataTransfers } from '../../../../../base/browser/dnd.js';
import { $, addDisposableListener, EventType, isHTMLElement } from '../../../../../base/browser/dom.js';
import { CodeWindow } from '../../../../../base/browser/window.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { UriList } from '../../../../../base/common/dataTransfer.js';
import { onUnexpectedError } from '../../../../../base/common/errors.js';
import { Disposable, DisposableMap, toDisposable } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { CodeDataTransfers, containsDragType, extractEditorsDropData, LocalSelectionTransfer } from '../../../../../platform/dnd/browser/dnd.js';
import { DraggedEditorGroupIdentifier, DraggedEditorIdentifier, registerInputDropTarget } from '../../../../browser/dnd.js';
import { IEditorGroupView } from '../../../../browser/parts/editor/editor.js';
import { EditorResourceAccessor, GroupIdentifier, SideBySideEditor } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IContentPart, IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IHostService } from '../../../../services/host/browser/host.js';
import { MultiDiffEditorInput } from '../../../multiDiffEditor/browser/multiDiffEditorInput.js';
import { TerminalDataTransfers } from '../../../terminal/browser/terminal.js';
import { TerminalEditorInput } from '../../../terminal/browser/terminalEditorInput.js';
import { WebviewInput } from '../../../webviewPanel/browser/webviewEditorInput.js';
import { AGENT_DOCK_SELECTION_DATA_TRANSFER, AgentDockDropTargetKind, getAgentDockDropTargetKind, IAgentDockSelection, isAgentDockFileDrag, normalizeAgentDockDropResources, parseAgentDockSelection } from '../../common/agentDock/agentDockDrop.js';
import { AgentDockInsertPayload, IAgentDockInsertService } from './agentDockInsertService.js';
import { AgentDockPreviewDrag } from './agentDockPreviewDrag.js';
import { describeAgentDockEditor, IAgentDockService } from './agentDockService.js';

/** The tab of the dock that a drag of files is over, which takes the files when they drop. */
export interface IAgentDockDropTarget {
	readonly group: IEditorGroupView;
	readonly kind: AgentDockDropTargetKind;
	/** Whether the drag is over the terminal itself, whose own handling of drops the dock takes over. */
	readonly overTerminal: boolean;
}

/**
 * How long the drop feedback stays without a drag event over the dock: a drag from another application, which can leave
 * the window without a `dragend`, leaves none behind.
 */
const OVERLAY_TIMEOUT = 500;

/**
 * Drops files, such as from the Explorer, the Source Control view or editor tabs, into the tab of the dock under the
 * pointer, without a key held: a terminal gets their paths typed in, and Claude Code an @-mention of each in its chat
 * input. The selection of an editor, dragged by its badge (`AgentDockSelectionBadge`), goes in as an @-mention of its
 * lines. Groups, terminals and the dock's own tabs still move and split groups as they would without it.
 *
 * The workbench stands down for such drags as the groups of the dock register as inputs that take them. The dock takes
 * them before anything else, in the capture phase on the window, which also reaches drags over the panels of agents: those
 * show in webviews outside the dock's elements.
 */
export class AgentDockDropController extends Disposable {

	private readonly editorTransfer = LocalSelectionTransfer.getInstance<DraggedEditorIdentifier>();
	private readonly groupTransfer = LocalSelectionTransfer.getInstance<DraggedEditorGroupIdentifier>();

	private readonly inputDropTargets = this._register(new DisposableMap<GroupIdentifier>());

	private readonly overlay = $('.vsade-agent-dock-drop-overlay');
	private readonly hideOverlayScheduler = this._register(new RunOnceScheduler(() => this.hideOverlay(), OVERLAY_TIMEOUT));

	constructor(
		private readonly part: IContentPart,
		private readonly targetWindow: CodeWindow,
		@IAgentDockService private readonly agentDockService: IAgentDockService,
		@IAgentDockInsertService private readonly agentDockInsertService: IAgentDockInsertService,
		@IHostService private readonly hostService: IHostService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this._register(toDisposable(() => this.overlay.remove()));

		for (const group of part.groups) {
			this.registerGroup(group);
		}
		this._register(part.onDidAddGroup(group => this.registerGroup(group)));
		this._register(part.onDidRemoveGroup(group => this.inputDropTargets.deleteAndDispose(group.id)));

		this._register(addDisposableListener(targetWindow, EventType.DRAG_ENTER, e => this.onDrag(e), true));
		this._register(addDisposableListener(targetWindow, EventType.DRAG_OVER, e => this.onDrag(e), true));
		this._register(addDisposableListener(targetWindow, EventType.DRAG_LEAVE, e => this.onDrag(e), true));
		this._register(addDisposableListener(targetWindow, EventType.DROP, e => this.onDrop(targetWindow, e), true));
		this._register(addDisposableListener(targetWindow, EventType.DRAG_END, () => this.hideOverlay()));

		// Selections dragged from the Markdown preview, which cannot drag natively out of it
		this._register(instantiationService.createInstance(AgentDockPreviewDrag, this, targetWindow));
	}

	private registerGroup(group: IEditorGroup): void {
		const groupView = group as IEditorGroupView;
		this.inputDropTargets.set(group.id, registerInputDropTarget(groupView.element, {
			accepts: e => this.findTarget(e)?.group === groupView,
			getHint: () => localize('agentDock.dropHint', "Drop to insert the path"),
		}));
	}

	//#region Drag

	private onDrag(e: DragEvent): void {
		const target = this.findTarget(e);
		if (!target) {
			if (e.type === EventType.DRAG_OVER) {
				this.hideOverlay();
			}
			return;
		}

		// The terminal's own handling of drops types the path of the first file only, and none for a diff editor. It sees
		// either all of a drag over it or none of it, so that it shows no feedback of its own and keeps no state from it.
		if (target.overTerminal) {
			e.stopPropagation();
		}

		if (e.type === EventType.DRAG_LEAVE) {
			return;
		}

		e.preventDefault(); // the drop fires only when the drag is taken
		if (e.dataTransfer) {
			e.dataTransfer.dropEffect = 'copy';
		}

		this.showOverlay(target.group);
	}

	/**
	 * The tab that a drag is over, when the drag is one of files and the tab takes them: the active tab of a group of the
	 * dock, below its tabs, or the panel of an agent, which shows above its group.
	 */
	private findTarget(e: DragEvent): IAgentDockDropTarget | undefined {
		const element = e.target;
		if (!isHTMLElement(element) || !this.isFileDrag(e)) {
			return undefined;
		}

		return this.findTargetAt(element, e.clientY);
	}

	/** The tab that takes what drops on `element`, at `clientY` in the window, as for {@link findTarget}. */
	findTargetAt(element: HTMLElement, clientY: number): IAgentDockDropTarget | undefined {
		for (const group of this.part.groups as IEditorGroupView[]) {
			const editor = group.activeEditor;
			const kind = getAgentDockDropTargetKind(editor ? describeAgentDockEditor(editor) : undefined);

			if (group.element.contains(element)) {
				if (!kind) {
					return undefined;
				}

				const overTerminal = editor instanceof TerminalEditorInput && !!this.getTerminalDropElement(editor)?.contains(element);
				if (overTerminal || clientY >= group.element.getBoundingClientRect().top + group.titleHeight.offset) {
					return { group, kind, overTerminal };
				}

				return undefined; // over the tabs, which keep their own handling
			}

			if (kind === AgentDockDropTargetKind.ClaudeCode && editor instanceof WebviewInput && !editor.isDisposed() && editor.webview.container.contains(element)) {
				return { group, kind, overTerminal: false };
			}
		}

		return undefined;
	}

	private isFileDrag(e: DragEvent): boolean {
		const draggedEditors = this.editorTransfer.getData(DraggedEditorIdentifier.prototype) ?? [];

		return isAgentDockFileDrag({
			carriesSelection: containsDragType(e, AGENT_DOCK_SELECTION_DATA_TRANSFER),
			carriesResources: containsDragType(e, DataTransfers.RESOURCES, DataTransfers.FILES, DataTransfers.INTERNAL_URI_LIST, CodeDataTransfers.EDITORS, CodeDataTransfers.FILES)
				|| draggedEditors.some(({ identifier }) => normalizeAgentDockDropResources(this.getEditorResources(identifier.editor)).length > 0),
			draggingGroup: this.groupTransfer.hasData(DraggedEditorGroupIdentifier.prototype),
			draggingTerminals: containsDragType(e, TerminalDataTransfers.Terminals),
			draggingDockEditor: draggedEditors.some(({ identifier }) => this.agentDockService.isDockEditor(identifier.editor)),
		});
	}

	/** The element of a terminal that handles the drops on it (`TerminalInstance`), around the terminal itself. */
	private getTerminalDropElement(editor: TerminalEditorInput): HTMLElement | undefined {
		const element = editor.terminalInstance?.domElement;
		return element?.parentElement ?? element;
	}

	//#endregion

	//#region Feedback

	/**
	 * Shows where a drag drops. It hides by itself when no other drag event comes in time, unless `untilHidden`: a drag
	 * that is not a native one, which ends with {@link hideOverlay}.
	 */
	showOverlay(group: IEditorGroupView, untilHidden?: boolean): void {
		if (this.overlay.parentElement !== group.element) {
			group.element.appendChild(this.overlay);
		}

		const offset = group.titleHeight.offset;
		this.overlay.style.top = `${offset}px`;
		this.overlay.style.height = `calc(100% - ${offset}px)`;

		if (untilHidden) {
			this.hideOverlayScheduler.cancel();
		} else {
			this.hideOverlayScheduler.schedule();
		}
	}

	hideOverlay(): void {
		this.hideOverlayScheduler.cancel();
		this.overlay.remove();
	}

	//#endregion

	//#region Drop

	private onDrop(targetWindow: CodeWindow, e: DragEvent): void {
		this.hideOverlay();

		const target = this.findTarget(e);
		if (!target) {
			return;
		}

		// Nothing else handles the drop: not the terminal, nor the workbench, which would open the files
		e.preventDefault();
		e.stopPropagation();

		const editor = target.group.activeEditor;
		if (editor instanceof WebviewInput) {
			editor.webview.windowDidDragEnd(); // the panel takes the pointer again, which it does on a drop it sees
		}

		// The data of a drop can only be read while it is handled
		const payload = this.resolvePayload(e);
		if (payload) {
			this.insert(targetWindow, target, payload).catch(onUnexpectedError);
		}
	}

	/** Inserts a reference to `selection` into the tab of `target`, as a drop of the selection on it does. */
	async dropSelection(target: IAgentDockDropTarget, selection: IAgentDockSelection): Promise<void> {
		await this.insert(this.targetWindow, target, { kind: 'selection', selection });
	}

	private resolvePayload(e: DragEvent): AgentDockInsertPayload | undefined {
		const selectionData = e.dataTransfer?.getData(AGENT_DOCK_SELECTION_DATA_TRANSFER);
		if (selectionData) {
			const selection = parseAgentDockSelection(selectionData);
			return selection ? { kind: 'selection', selection } : undefined;
		}

		const resources = this.resolveResources(e);
		return resources.length ? { kind: 'resources', resources } : undefined;
	}

	/**
	 * The files of a drop: the modified file of a dragged diff editor, every file of a dragged editor of several diffs,
	 * and the folders dragged from the Explorer too.
	 */
	private resolveResources(e: DragEvent): URI[] {
		const resources: URI[] = [];

		const draggedEditors = this.editorTransfer.getData(DraggedEditorIdentifier.prototype);
		if (draggedEditors?.length) {
			for (const { identifier } of draggedEditors) {
				resources.push(...this.getEditorResources(identifier.editor));
			}
		} else {
			for (const editor of extractEditorsDropData(e)) {
				if (editor.resource) {
					resources.push(editor.resource);
				}
			}

			const uriList = e.dataTransfer?.getData(DataTransfers.INTERNAL_URI_LIST);
			if (uriList) {
				for (const entry of UriList.parse(uriList)) {
					try {
						resources.push(URI.parse(entry));
					} catch {
						// not a URI
					}
				}
			}
		}

		return normalizeAgentDockDropResources(resources);
	}

	/**
	 * The resources a dragged editor stands for: the modified side of a diff, and of each diff of an editor of several,
	 * such as the staged changes of a repository, which carries none on the drag's data.
	 */
	private getEditorResources(editor: EditorInput): URI[] {
		if (editor instanceof MultiDiffEditorInput) {
			return (editor.resources.get() ?? []).flatMap(item => {
				const resource = item.modifiedUri ?? item.originalUri; // the original of a deleted file
				return resource ? [resource] : [];
			});
		}

		const resource = EditorResourceAccessor.getOriginalUri(editor, { supportSideBySide: SideBySideEditor.PRIMARY });
		return resource ? [resource] : [];
	}

	private async insert(targetWindow: CodeWindow, target: IAgentDockDropTarget, payload: AgentDockInsertPayload): Promise<void> {
		if (!targetWindow.document.hasFocus()) {
			await this.hostService.focus(targetWindow); // a drop from another application
		}

		await this.agentDockInsertService.insert(target.group, payload);
	}

	//#endregion
}
