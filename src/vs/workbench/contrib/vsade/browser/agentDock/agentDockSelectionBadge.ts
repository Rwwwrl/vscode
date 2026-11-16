/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $, addDisposableListener, append, EventType, getWindow, IDimension } from '../../../../../base/browser/dom.js';
import { HoverStyle } from '../../../../../base/browser/ui/hover/hover.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { Disposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { ContentWidgetPositionPreference, ICodeEditor, IContentWidget, IContentWidgetPosition, IEditorMouseEvent, MouseTargetType } from '../../../../../editor/browser/editorBrowser.js';
import { EditorOption } from '../../../../../editor/common/config/editorOptions.js';
import { IPosition } from '../../../../../editor/common/core/position.js';
import { Selection, SelectionDirection } from '../../../../../editor/common/core/selection.js';
import { IEditorContribution } from '../../../../../editor/common/editorCommon.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { AgentDockSelectionBadgeMode, AgentDockSettingId } from '../../common/agentDock/agentDock.js';
import { AGENT_DOCK_SELECTION_DATA_TRANSFER, createAgentDockSelection, IAgentDockSelection, normalizeAgentDockDropResources, serializeAgentDockSelection } from '../../common/agentDock/agentDockDrop.js';
import './media/agentDockSelectionBadge.css';

/** How long a selection stays as it is before the badge moves to it: it does not follow each step of the keyboard. */
const UPDATE_DELAY = 150;

/** The width of the badge, as far as placing it goes, before it rendered once. */
const ESTIMATED_WIDTH = 140;

/**
 * The selection of `editor` as the dock takes it, from its badge or from the keyboard: nothing when nothing is selected,
 * or when the editor is not of a file, nor of a read-only version of one.
 */
export function getAgentDockEditorSelection(editor: ICodeEditor): IAgentDockSelection | undefined {
	const model = editor.getModel();
	const selection = editor.getSelection();
	if (!model || !selection || selection.isEmpty()) {
		return undefined;
	}

	return createAgentDockSelection(model.uri, selection, model.getValueInRange(selection), lineNumber => model.getLineContent(lineNumber));
}

/**
 * A badge next to the selection of an editor of a file, which drags a reference to the selected lines onto a terminal or
 * Claude Code in the Agent Dock (see `AgentDockDropController`): what Claude Code's "Insert @-Mention" command does from
 * the keyboard, with the mouse alone.
 */
export class AgentDockSelectionBadge extends Disposable implements IEditorContribution, IContentWidget {

	static readonly ID = 'vsade.agentDock.selectionBadge';

	private static idPool = 0;

	readonly allowEditorOverflow = false;

	/** The editor leaves the mouse to the badge, which starts a drag with it. */
	readonly suppressMouseDown = false;

	private readonly id = `${AgentDockSelectionBadge.ID}.${AgentDockSelectionBadge.idPool++}`;
	private readonly domNode = $('.vsade-agent-dock-selection-badge');
	private readonly badge = append(this.domNode, $('.vsade-agent-dock-selection-badge-content'));
	private widgetPosition: IContentWidgetPosition | null = null;
	private visible = false;

	private mode: AgentDockSelectionBadgeMode;

	/** Whether the mouse is down on the editor, such as while it selects: the badge shows when it is up again. */
	private mouseDown = false;
	private readonly mouseUpListener = this._register(new MutableDisposable());

	/** Whether the selection is one the mouse made, also when the keyboard changed it since. */
	private selectedByMouse = false;

	private readonly updateScheduler = this._register(new RunOnceScheduler(() => this.update(), UPDATE_DELAY));

	constructor(
		private readonly editor: ICodeEditor,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IHoverService private readonly hoverService: IHoverService,
	) {
		super();

		this.mode = this.readMode();

		this.domNode.draggable = true;
		this.domNode.setAttribute('aria-hidden', 'true'); // for the mouse only: the keyboard has `vsade.agentDock.insertSelection`

		// The editor sets the display of the widget's own element: the badge lays out inside it
		append(this.badge, $(ThemeIcon.asCSSSelector(Codicon.mention)));
		append(this.badge, $('span.vsade-agent-dock-selection-badge-label', undefined, localize('agentDock.selectionBadge', "Drag to Agent")));

		this._register(this.hoverService.setupDelayedHover(this.domNode, {
			content: localize('agentDock.selectionBadgeHover', "Drag onto a terminal or Claude Code in the Agent Dock to insert a reference to the selected lines"),
			style: HoverStyle.Pointer,
		}));

		this._register(addDisposableListener(this.domNode, EventType.DRAG_START, e => this.onDragStart(e)));
		this._register(addDisposableListener(this.domNode, EventType.DRAG_END, e => this.onDragEnd(e)));

		this._register(this.editor.onMouseDown(e => this.onMouseDown(e)));
		this._register(this.editor.onDidChangeCursorSelection(() => this.onDidChangeSelection()));
		this._register(this.editor.onDidScrollChange(e => {
			if (this.visible && e.scrollLeftChanged) {
				this.update(); // the end of the line can come into view or leave it
			}
		}));
		this._register(this.editor.onDidLayoutChange(() => {
			if (this.visible) {
				this.update();
			}
		}));
		this._register(this.editor.onDidChangeModel(() => {
			this.selectedByMouse = false;
			this.update();
		}));
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(AgentDockSettingId.SelectionBadge)) {
				this.mode = this.readMode();
				this.update();
			}
		}));
	}

	private readMode(): AgentDockSelectionBadgeMode {
		switch (this.configurationService.getValue<string>(AgentDockSettingId.SelectionBadge)) {
			case AgentDockSelectionBadgeMode.Always: return AgentDockSelectionBadgeMode.Always;
			case AgentDockSelectionBadgeMode.Off: return AgentDockSelectionBadgeMode.Off;
			default: return AgentDockSelectionBadgeMode.Mouse;
		}
	}

	//#region Selection

	private onMouseDown(e: IEditorMouseEvent): void {
		if (!e.event.leftButton || (e.target.type === MouseTargetType.CONTENT_WIDGET && e.target.detail === this.id)) {
			return; // a context menu can take the mouse, and the mouse on the badge drags it
		}

		this.mouseDown = true;
		this.updateScheduler.cancel();
		this.hide();

		// Also when the mouse is up outside of the editor, where the editor does not tell
		const editorWindow = getWindow(this.editor.getDomNode());
		this.mouseUpListener.value = addDisposableListener(editorWindow, EventType.POINTER_UP, () => this.onMouseUp(), true);
	}

	private onMouseUp(): void {
		this.mouseUpListener.clear();
		this.mouseDown = false;
		const selection = this.editor.getSelection();
		this.selectedByMouse = !!selection && !selection.isEmpty();

		this.update();
	}

	private onDidChangeSelection(): void {
		if (this.editor.getSelection()?.isEmpty() ?? true) {
			this.selectedByMouse = false;
			this.updateScheduler.cancel();
			this.hide();
		} else if (!this.mouseDown) {
			this.updateScheduler.schedule();
		}
	}

	/**
	 * The selection that the badge shows next to, if any: one of a file, which the dock can refer to, or of a read-only
	 * version of one, such as its staged version.
	 */
	private getSelection(): Selection | undefined {
		if (this.mouseDown || this.mode === AgentDockSelectionBadgeMode.Off || (this.mode === AgentDockSelectionBadgeMode.Mouse && !this.selectedByMouse)) {
			return undefined;
		}

		const selection = this.editor.getSelection();
		const model = this.editor.getModel();
		if (!selection || selection.isEmpty() || !model || !normalizeAgentDockDropResources([model.uri]).length) {
			return undefined;
		}

		return selection;
	}

	//#endregion

	//#region Widget

	/**
	 * Shows the badge to the right of the text of the line the cursor is at, where it covers no code; at the cursor, above
	 * or below the selection, when the end of that line is out of view.
	 */
	private update(): void {
		this.updateScheduler.cancel();

		const model = this.editor.getModel();
		const selection = this.getSelection();
		if (!model || !selection) {
			this.hide();
			return;
		}

		// A selection of whole lines ends at the start of the line after them: nothing of that line is selected
		let lineNumber = selection.positionLineNumber;
		if (selection.positionColumn === 1 && selection.getDirection() === SelectionDirection.LTR && lineNumber > selection.startLineNumber) {
			lineNumber--;
		}

		const endOfLine = { lineNumber, column: model.getLineMaxColumn(lineNumber) };
		const atLineEnd = this.fitsAt(endOfLine);
		this.domNode.classList.toggle('at-line-end', atLineEnd);
		if (atLineEnd) {
			this.widgetPosition = { position: endOfLine, preference: [ContentWidgetPositionPreference.EXACT] };
		} else {
			const above = selection.getDirection() === SelectionDirection.RTL;
			this.widgetPosition = {
				position: selection.getPosition(),
				preference: above
					? [ContentWidgetPositionPreference.ABOVE, ContentWidgetPositionPreference.BELOW]
					: [ContentWidgetPositionPreference.BELOW, ContentWidgetPositionPreference.ABOVE],
			};
		}

		if (this.visible) {
			this.editor.layoutContentWidget(this);
		} else {
			this.visible = true;
			this.editor.addContentWidget(this);
		}
	}

	/** Whether the badge, placed at `position`, shows whole within the visible text of the editor. */
	private fitsAt(position: IPosition): boolean {
		const scrolled = this.editor.getScrolledVisiblePosition(position);
		if (!scrolled) {
			return false;
		}

		const layoutInfo = this.editor.getLayoutInfo();
		const width = this.domNode.offsetWidth || ESTIMATED_WIDTH; // not rendered yet the first time
		return scrolled.left >= layoutInfo.contentLeft && scrolled.left + width <= layoutInfo.contentLeft + layoutInfo.contentWidth - layoutInfo.verticalScrollbarWidth;
	}

	beforeRender(): IDimension | null {
		// As tall as the line it is on, so that it covers no other line next to the code
		const position = this.widgetPosition?.position;
		const lineHeight = position ? this.editor.getLineHeightForPosition(position) : this.editor.getOption(EditorOption.lineHeight);
		this.badge.style.height = `${lineHeight}px`;

		return null;
	}

	private hide(): void {
		if (this.visible) {
			this.visible = false;
			this.editor.removeContentWidget(this);
		}
	}

	getId(): string {
		return this.id;
	}

	getDomNode(): HTMLElement {
		return this.domNode;
	}

	getPosition(): IContentWidgetPosition | null {
		return this.widgetPosition;
	}

	//#endregion

	//#region Drag

	private onDragStart(e: DragEvent): void {
		const dragged = getAgentDockEditorSelection(this.editor);
		if (!e.dataTransfer || !dragged) {
			e.preventDefault();
			return;
		}

		this.hoverService.hideHover(true); // the mouse does not leave the badge while it drags

		// Nothing but the dock takes the drag: as text, it would also drop into the editor it comes from
		e.dataTransfer.effectAllowed = 'copy';
		e.dataTransfer.setData(AGENT_DOCK_SELECTION_DATA_TRANSFER, serializeAgentDockSelection(dragged));
	}

	private onDragEnd(e: DragEvent): void {
		if (e.dataTransfer?.dropEffect === 'none') {
			this.editor.focus(); // nothing took the drag, and the mouse on the badge took the focus from the editor
		}
	}

	//#endregion

	override dispose(): void {
		this.hide();

		super.dispose();
	}
}
