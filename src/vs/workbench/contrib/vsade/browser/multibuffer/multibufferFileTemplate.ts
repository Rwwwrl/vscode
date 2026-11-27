/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, EventType, getWindow, h, isHTMLElement, scheduleAtNextAnimationFrame } from '../../../../../base/browser/dom.js';
import { ActionBar } from '../../../../../base/browser/ui/actionbar/actionbar.js';
import { Button } from '../../../../../base/browser/ui/button/button.js';
import { applyDragImage } from '../../../../../base/browser/ui/dnd/dnd.js';
import { Action } from '../../../../../base/common/actions.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Codicon } from '../../../../../base/common/codicons.js';
import { BugIndicatingError } from '../../../../../base/common/errors.js';
import { DisposableStore, MutableDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { autorun, constObservable, derived, IObservable, ISettableObservable, ITransaction, observableValue, runOnChange } from '../../../../../base/common/observable.js';
import { deepClone } from '../../../../../base/common/objects.js';
import { basename } from '../../../../../base/common/resources.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { isObject } from '../../../../../base/common/types.js';
import { ICodeEditor, MouseTargetType } from '../../../../../editor/browser/editorBrowser.js';
import { EditorExtensionsRegistry } from '../../../../../editor/browser/editorExtensions.js';
import { observableCodeEditor } from '../../../../../editor/browser/observableCodeEditor.js';
import { CodeEditorWidget } from '../../../../../editor/browser/widget/codeEditor/codeEditorWidget.js';
import { PlaceholderViewZone, ViewZoneOverlayWidget } from '../../../../../editor/browser/widget/diffEditor/utils.js';
import { ActionRunnerWithContext } from '../../../../../editor/browser/widget/multiDiffEditor/utils.js';
import { IVirtualizedItemBindingContext, VirtualizedItemBinding, VirtualizedItemTemplate } from '../../../../../editor/browser/widget/multiDiffEditor/virtualizedItemManager.js';
import { EditorOption, IEditorOptions } from '../../../../../editor/common/config/editorOptions.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { OffsetRange } from '../../../../../editor/common/core/ranges/offsetRange.js';
import { Selection } from '../../../../../editor/common/core/selection.js';
import { IEditorDecorationsCollection } from '../../../../../editor/common/editorCommon.js';
import { ITextModel, TrackedRangeStickiness } from '../../../../../editor/common/model.js';
import { ModelDecorationOptions } from '../../../../../editor/common/model/textModel.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { ITextResourceConfigurationService } from '../../../../../editor/common/services/textResourceConfiguration.js';
import { CommonFindController } from '../../../../../editor/contrib/find/browser/findController.js';
import { FindDecorations } from '../../../../../editor/contrib/find/browser/findDecorations.js';
import { localize } from '../../../../../nls.js';
import { createActionViewItem } from '../../../../../platform/actions/browser/menuEntryActionViewItem.js';
import { MenuWorkbenchToolBar } from '../../../../../platform/actions/browser/toolbar.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { ILabelService } from '../../../../../platform/label/common/label.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { fillEditorsDragData } from '../../../../browser/dnd.js';
import { ResourceLabel } from '../../../../browser/labels.js';
import { IMultibufferOpenFileContext, MultibufferCommandId, MultibufferDoubleClickBehaviour, MultibufferFileToolbarMenu, MultibufferSettingId } from '../../common/multibuffer/multibuffer.js';
import { clampExcerpts, computeExcerptGaps, excerptsEqual, expandExcerpt, findExcerptIndex, IMultibufferExcerpt, IMultibufferExcerptGap } from '../../common/multibuffer/multibufferExcerpts.js';
import { MultibufferFileItem } from './multibufferModel.js';

/** The height of the header of a file, which sticks to the top of the multibuffer while the file scrolls under it. */
export const MULTIBUFFER_FILE_HEADER_HEIGHT = 36;

/** The height of the separator in place of the hidden lines of a file, between its excerpts and around them. */
export const MULTIBUFFER_SEPARATOR_HEIGHT = 24;

/**
 * How long an editor of a file that is not loaded yet waits before it loads the file: scrolling past a file quickly does
 * not open it, such as for its language server.
 */
const LOAD_DELAY = 100;

/** The key of the hidden areas of the editors of a multibuffer, apart from those of other features. */
const HIDDEN_AREAS_SOURCE = { id: 'vsade.multibuffer.excerpts' };

const EXCERPT_DECORATION = ModelDecorationOptions.register({
	description: 'vsade-multibuffer-excerpt',
	stickiness: TrackedRangeStickiness.AlwaysGrowsWhenTypingAtEdges,
});

const MATCH_DECORATION = ModelDecorationOptions.register({
	description: 'vsade-multibuffer-match',
	className: 'vsade-multibuffer-match',
	stickiness: TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges,
});

/** What the files of a multibuffer need from the multibuffer around them. */
export interface IMultibufferFileHost {
	/** How many lines an excerpt grows by each time it is expanded. */
	readonly expandLines: IObservable<number>;
	/** Whether the files show only the lines with matches instead of their excerpts. */
	readonly matchLinesOnly: IObservable<boolean>;
	/** Tells the line height of the editors, for the height of the files that are not shown. */
	reportLineHeight(lineHeight: number): void;
	/** The editor of `item` got the focus. */
	setActive(item: MultibufferFileItem): void;
	/** Scrolls the multibuffer by `delta`, such as when the editor of a file scrolled to reveal its cursor. */
	scrollBy(delta: number): void;
	/** Scrolls the multibuffer as little as it takes to show the part of `item` from `top` to `bottom`. */
	reveal(item: MultibufferFileItem, top: number, bottom: number): void;
	/** Scrolls the multibuffer to show the part of `item` from `top` to `bottom` in the middle, unless it shows it already. */
	revealCentered(item: MultibufferFileItem, top: number, bottom: number): void;
	/** The matches of the find of the multibuffer, which the editors of the files highlight. */
	readonly findDecorations: IObservable<IMultibufferFindDecorations | undefined>;
	/** The file of `binding` changed while it was shown, such as in another editor. */
	notifyFileContentChanged(item: MultibufferFileItem): void;
	/** The editor of `binding` loaded its file. */
	onDidAttach(binding: MultibufferFileBinding): void;
}

/** The matches of the find of a multibuffer by file, and the one it is at. */
export interface IMultibufferFindDecorations {
	readonly matches: ReadonlyMap<MultibufferFileItem, readonly Range[]>;
	readonly current: { readonly item: MultibufferFileItem; readonly range: Range } | undefined;
}

/**
 * A file of a multibuffer: a header with its name, and an editor of the file that hides the lines outside its excerpts.
 * The multibuffer pools these, and binds each to one file at a time while the file is on screen.
 */
export class MultibufferFileTemplate extends VirtualizedItemTemplate<MultibufferFileItem, MultibufferFileBinding> {

	readonly elements = h('div.vsade-multibuffer-file', [
		h('div.vsade-multibuffer-file-header@header', [
			h('div.vsade-multibuffer-file-collapse@collapse'),
			h('div.vsade-multibuffer-file-label.show-file-icons@label'),
			h('div.vsade-multibuffer-file-count@count'),
			h('div.vsade-multibuffer-file-actions@actions'),
		]),
		h('div.vsade-multibuffer-file-message@message'),
		h('div.vsade-multibuffer-file-editor@editor'),
	]);

	readonly editor: CodeEditorWidget;
	readonly isFocused: IObservable<boolean>;
	readonly item = observableValue<MultibufferFileItem | undefined>(this, undefined);

	private readonly label: ResourceLabel;
	private readonly collapseButton: Button;

	constructor(
		container: HTMLElement,
		overflowWidgetsDomNode: HTMLElement,
		readonly scrollLeft: IObservable<number>,
		readonly host: IMultibufferFileHost,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@ICommandService private readonly commandService: ICommandService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@ILabelService private readonly labelService: ILabelService,
		@IWorkspaceContextService workspaceContextService: IWorkspaceContextService,
	) {
		super();

		this.elements.header.style.height = `${MULTIBUFFER_FILE_HEADER_HEIGHT}px`;
		this.editor = this._register(this.instantiationService.createInstance(CodeEditorWidget, this.elements.editor, {
			overflowWidgetsDomNode,
			fixedOverflowWidgets: true,
			scrollBeyondLastLine: false,
			scrollbar: {
				vertical: 'hidden',
				horizontal: 'hidden',
				handleMouseWheel: false,
				alwaysConsumeMouseWheel: false,
				useShadows: false,
			},
		}, {
			// The contributions of any editor of the file, with the Agent Dock badge among them, but for the find of the
			// editor: the multibuffer has its own, which finds in all files and only in the lines they show
			contributions: EditorExtensionsRegistry.getEditorContributions().filter(contribution => contribution.id !== CommonFindController.ID),
		}));
		this.isFocused = observableCodeEditor(this.editor).isFocused;

		this.label = this._register(this.instantiationService.createInstance(ResourceLabel, this.elements.label, {}));
		// The path of the label is relative to the workspace folders and formatted by the label service, which the label
		// only follows for the name it computes itself
		this._register(this.labelService.onDidChangeFormatters(() => this.renderLabel()));
		this._register(workspaceContextService.onDidChangeWorkspaceFolders(() => this.renderLabel()));

		this.collapseButton = this._register(new Button(this.elements.collapse, {}));
		this._register(autorun(reader => {
			const collapsed = this.item.read(reader)?.collapsed.read(reader) ?? false;
			this.collapseButton.element.className = '';
			this.collapseButton.icon = collapsed ? Codicon.chevronRight : Codicon.chevronDown;
			this.collapseButton.element.setAttribute('aria-label', collapsed ? localize('multibuffer.expandFile', "Expand File") : localize('multibuffer.collapseFile', "Collapse File"));
			this.elements.editor.style.display = collapsed ? 'none' : '';
			this.elements.root.classList.toggle('collapsed', collapsed);
		}));
		this._register(this.collapseButton.onDidClick(() => this.toggleCollapsed()));

		// The header is the file, as a tab is: double-clicking it opens the file, and it drags as the file, such as into a
		// terminal or an agent
		this._register(addDisposableListener(this.elements.header, EventType.DBLCLICK, e => {
			const target = e.target;
			if (isHTMLElement(target) && (this.elements.collapse.contains(target) || this.elements.actions.contains(target))) {
				return;
			}
			const context = this.currentBinding.get()?.getOpenFileContext();
			if (context) {
				this.openFile(context, this.configurationService.getValue(MultibufferSettingId.DoubleClickBehaviour) === MultibufferDoubleClickBehaviour.OpenFileToSide);
			}
		}));
		this.elements.header.draggable = true;
		this._register(addDisposableListener(this.elements.header, EventType.DRAG_START, e => {
			const item = this.item.get();
			if (!item || !e.dataTransfer) {
				return;
			}
			e.dataTransfer.effectAllowed = 'copyMove';
			this.instantiationService.invokeFunction(accessor => fillEditorsDragData(accessor, [item.resource], e));
			applyDragImage(e, this.elements.label, basename(item.resource));
		}));

		// Double-clicking a line opens the file there, unless the setting keeps the word selection of the editor
		this._register(this.editor.onMouseUp(e => {
			const item = this.item.get();
			const position = e.target.position;
			if (e.event.detail !== 2 || !item || !position || (e.target.type !== MouseTargetType.CONTENT_TEXT && e.target.type !== MouseTargetType.CONTENT_EMPTY)) {
				return;
			}
			const behaviour = this.configurationService.getValue<MultibufferDoubleClickBehaviour>(MultibufferSettingId.DoubleClickBehaviour);
			if (behaviour === MultibufferDoubleClickBehaviour.SelectWord) {
				return;
			}
			const selection = Range.fromPositions(position);
			this.editor.setSelection(selection);
			this.openFile({ resource: item.resource, selection }, behaviour === MultibufferDoubleClickBehaviour.OpenFileToSide);
		}));

		// The toolbar of the header gets the file and the selection in it, whichever file the template shows then
		const toolbarContextKeyService = this._register(contextKeyService.createScoped(this.elements.actions));
		const toolbarInstantiationService = this._register(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, toolbarContextKeyService])));
		this._register(toolbarInstantiationService.createInstance(MenuWorkbenchToolBar, this.elements.actions, MultibufferFileToolbarMenu, {
			actionRunner: this._register(new ActionRunnerWithContext(() => this.currentBinding.get()?.getOpenFileContext())),
			menuOptions: { shouldForwardArgs: true },
			toolbarOptions: { primaryGroup: () => true },
			actionViewItemProvider: (action, options) => createActionViewItem(toolbarInstantiationService, action, options),
		}));

		container.appendChild(this.elements.root);
		this._register(toDisposable(() => this.elements.root.remove()));
	}

	protected createBinding(item: MultibufferFileItem, context: IVirtualizedItemBindingContext): MultibufferFileBinding {
		this.item.set(item, undefined);
		this.renderLabel();
		const count = item.matches.length;
		this.elements.count.textContent = count === 1
			? localize('multibuffer.oneMatch', "1 match")
			: localize('multibuffer.matches', "{0} matches", count);
		this.elements.message.textContent = '';
		this.elements.message.style.display = 'none';
		return this.instantiationService.createInstance(MultibufferFileBinding, item, this, context);
	}

	/**
	 * Labels the bound file with its icon and its path relative to the workspace, in one piece rather than a name and a
	 * dimmed folder, as a fuzzy file finder lists files.
	 */
	private renderLabel(): void {
		const item = this.item.get();
		if (!item) {
			return;
		}
		this.label.element.setResource({ resource: item.resource, name: this.labelService.getUriLabel(item.resource, { relative: true }) });
	}

	/** Called by the binding of `item` once it released the editor. */
	unbind(item: MultibufferFileItem): void {
		if (this.item.get() !== item) {
			throw new BugIndicatingError('Cannot unbind a multibuffer file template from another file');
		}
		this.item.set(undefined, undefined);
		this.label.element.clear();
		this.hide();
	}

	showMessage(message: string): void {
		this.elements.message.textContent = message;
		this.elements.message.style.display = '';
	}

	render(renderedRange: OffsetRange, width: number, viewport: OffsetRange): void {
		const root = this.elements.root;
		root.style.visibility = 'visible';
		root.style.position = 'absolute';
		root.style.top = `${renderedRange.start}px`;
		root.style.height = `${renderedRange.length}px`;
		root.style.width = `${width}px`;

		// The header sticks to the top of the viewport while the rest of the file is under it
		const maxDelta = Math.max(0, renderedRange.length - MULTIBUFFER_FILE_HEADER_HEIGHT);
		const delta = Math.max(0, Math.min(viewport.start - renderedRange.start, maxDelta));
		this.elements.header.style.transform = `translateY(${delta}px)`;
		this.elements.header.classList.toggle('shadow', delta > 0);
	}

	hide(): void {
		this.elements.root.style.top = '-100000px';
		this.elements.root.style.visibility = 'hidden';
	}

	private toggleCollapsed(): void {
		const item = this.item.get();
		item?.collapsed.set(!item.collapsed.get(), undefined);
	}

	private openFile(context: IMultibufferOpenFileContext, sideBySide: boolean): void {
		void this.commandService.executeCommand(sideBySide ? MultibufferCommandId.OpenFileToSide : MultibufferCommandId.OpenFile, context);
	}
}

/**
 * The binding of a template to one file while the file is on screen. It loads the file into the editor after a short
 * delay, hides the lines outside the excerpts, and keeps the excerpts where they are as the file changes.
 */
export class MultibufferFileBinding extends VirtualizedItemBinding<MultibufferFileItem> {

	readonly size: IObservable<number>;
	readonly maxScroll: IObservable<{ readonly maxScroll: number }>;
	readonly shouldKeepAlive: IObservable<boolean>;

	readonly editor: CodeEditorWidget;
	private readonly editorHeight: ISettableObservable<number>;
	private readonly contentWidth = observableValue(this, 0);
	private readonly layoutWidth = observableValue(this, 0);

	private model: ITextModel | undefined;
	/** The reference to the model of the file, which outlives the editor showing it. */
	private readonly modelStore = this._register(new DisposableStore());
	/** What reacts to the model while the editor shows it. */
	private readonly attachedStore = this._register(new DisposableStore());
	private readonly separators = this._register(new DisposableStore());
	private zoneIds: string[] = [];
	private gaps: IMultibufferExcerptGap[] = [];
	private excerptDecorations: IEditorDecorationsCollection | undefined;
	private matchDecorations: IEditorDecorationsCollection | undefined;
	private findDecorations: IEditorDecorationsCollection | undefined;

	/** Set while the binding changes the editor itself, whose scroll events then do not move the multibuffer. */
	private isUpdatingEditor = false;
	private renderedScrollOffset = 0;

	private observedEditorHeight: number;
	private readonly heightUpdate = this._register(new MutableDisposable());

	constructor(
		item: MultibufferFileItem,
		private readonly template: MultibufferFileTemplate,
		private readonly context: IVirtualizedItemBindingContext,
		@ITextModelService private readonly textModelService: ITextModelService,
		@IModelService private readonly modelService: IModelService,
		@ITextResourceConfigurationService private readonly textResourceConfigurationService: ITextResourceConfigurationService,
	) {
		super(item);
		this.editor = template.editor;

		const collapsed = item.collapsed.get();
		this.observedEditorHeight = collapsed
			? item.measuredEditorHeight.get() ?? 0
			: Math.max(0, context.initialSize - MULTIBUFFER_FILE_HEADER_HEIGHT);
		this.editorHeight = observableValue(this, this.observedEditorHeight);
		this.size = derived(this, reader => item.collapsed.read(reader)
			? MULTIBUFFER_FILE_HEADER_HEIGHT
			: MULTIBUFFER_FILE_HEADER_HEIGHT + this.editorHeight.read(reader));
		this.maxScroll = derived(this, reader => ({ maxScroll: Math.max(0, this.contentWidth.read(reader) - this.layoutWidth.read(reader)) }));
		this.shouldKeepAlive = template.isFocused;

		this._register(autorun(reader => {
			const scrollLeft = template.scrollLeft.read(reader);
			this.editor.setScrollLeft(scrollLeft);
		}));
		this._register(this.editor.onDidLayoutChange(layoutInfo => this.layoutWidth.set(layoutInfo.contentWidth, undefined)));
		this._register(this.editor.onDidContentSizeChange(e => {
			this.contentWidth.set(e.contentWidth, undefined);
			if (e.contentHeightChanged && this.model) {
				this.observedEditorHeight = e.contentHeight;
				this.scheduleHeightUpdate();
			}
		}));
		this._register(this.editor.onDidFocusEditorWidget(() => template.host.setActive(item)));

		// A reveal in the editor, such as of its cursor, scrolls the multibuffer instead: the multibuffer scrolls the editor
		this._register(this.editor.onDidScrollChange(e => {
			if (!e.scrollTopChanged || this.isUpdatingEditor || !this.model || !this.editor.hasWidgetFocus()) {
				return;
			}
			const delta = e.scrollTop - this.renderedScrollOffset;
			if (delta !== 0) {
				template.host.scrollBy(delta);
			}
		}));
		this._register(this.editor.onDidChangeCursorPosition(e => {
			if (e.source === 'mouse' || e.source === 'api' || !this.model || !this.editor.hasWidgetFocus()) {
				return;
			}
			const top = this.getPositionOffset(e.position.lineNumber, e.position.column);
			template.host.reveal(item, top, top + this.editor.getLineHeightForPosition(e.position));
		}));

		this._register(this.textResourceConfigurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(item.resource, 'editor') || e.affectsConfiguration(item.resource, 'problems.visibility')) {
				this.editor.updateOptions(this.computeEditorOptions());
			}
		}));

		this.load();
	}

	/** The height of the editor, for the place of the file in the scroll once it is not shown. */
	getEditorHeight(): number | undefined {
		return this.model ? this.observedEditorHeight : undefined;
	}

	getSelections(): Selection[] | undefined {
		return this.model ? this.editor.getSelections() ?? undefined : undefined;
	}

	getOpenFileContext(): IMultibufferOpenFileContext {
		const selection = this.model ? this.editor.getSelection() ?? undefined : undefined;
		return { resource: this.item.resource, selection: selection ?? this.item.matches[0] };
	}

	focus(): void {
		this.editor.focus();
	}

	/** Whether the editor shows the file yet: it loads it after the binding is created. */
	get isAttached(): boolean {
		return this.model !== undefined;
	}

	/** Selects `range`, a range of the lines the file shows, and scrolls the multibuffer to it. */
	revealRange(range: Range): void {
		if (!this.model) {
			return;
		}
		this.editor.setSelection(range);
		const top = this.getPositionOffset(range.startLineNumber, range.startColumn);
		this.template.host.revealCentered(this.item, top, top + this.editor.getLineHeightForPosition(range.getStartPosition()));
	}

	/**
	 * Grows the excerpt with the cursor, or the excerpt nearest to it, by `expandLines` lines up or down. The line of the
	 * cursor stays where it is on screen.
	 */
	expandAtCursor(direction: 'up' | 'down'): void {
		const position = this.editor.getPosition();
		const index = position ? findExcerptIndex(this.item.excerpts.get(), position.lineNumber) : undefined;
		if (!position || index === undefined) {
			return;
		}
		const excerpt = this.item.excerpts.get()[index];
		const anchorLineNumber = Math.min(Math.max(position.lineNumber, excerpt.startLineNumber), excerpt.endLineNumber);
		this.expand(index, direction, this.template.host.expandLines.get(), () => this.getLineOffset(anchorLineNumber));
	}

	/**
	 * Scrolls the multibuffer to the cursor, unless it shows it already.
	 */
	revealCursor(): void {
		const position = this.model ? this.editor.getPosition() : null;
		if (!position) {
			return;
		}
		const top = this.getPositionOffset(position.lineNumber, position.column);
		this.template.host.revealCentered(this.item, top, top + this.editor.getLineHeightForPosition(position));
	}

	render(renderedRange: OffsetRange, scrollOffset: number, width: number, renderedViewport: OffsetRange): void {
		this.template.render(renderedRange, width, renderedViewport);
		if (!this.item.collapsed.get()) {
			this.isUpdatingEditor = true;
			try {
				this.editor.layout({ width, height: Math.max(0, renderedRange.length - MULTIBUFFER_FILE_HEADER_HEIGHT) });
				this.editor.setScrollTop(scrollOffset);
				this.renderedScrollOffset = scrollOffset;
			} finally {
				this.isUpdatingEditor = false;
			}
		}
		this.flushHeight();
	}

	hide(): void {
		this.template.hide();
	}

	override dispose(): void {
		if (this._store.isDisposed) {
			return;
		}
		// The editor lets go of the model before the binding releases its reference to it
		this.detach();
		this.template.unbind(this.item);
		super.dispose();
	}

	private load(): void {
		const cts = new CancellationTokenSource();
		this._register(toDisposable(() => cts.dispose(true)));
		const resolve = async () => {
			try {
				const reference = await this.textModelService.createModelReference(this.item.resource);
				if (cts.token.isCancellationRequested) {
					reference.dispose();
					return;
				}
				this.modelStore.add(reference);
				this.attach(reference.object.textEditorModel);
			} catch (error) {
				if (!cts.token.isCancellationRequested) {
					this.template.showMessage(localize('multibuffer.cannotOpen', "The file cannot be shown: {0}", error instanceof Error ? error.message : String(error)));
				}
			}
		};
		// A file that is open already loads at once: only a file that is not would open for its language server
		if (this.modelService.getModel(this.item.resource)) {
			void resolve();
		} else {
			const timeout = setTimeout(() => void resolve(), LOAD_DELAY);
			this._register(toDisposable(() => clearTimeout(timeout)));
		}
	}

	private attach(model: ITextModel): void {
		const item = this.item;
		this.isUpdatingEditor = true;
		try {
			this.editor.updateOptions(this.computeEditorOptions());
			this.editor.setModel(model);
			this.model = model;
			item.lineCount = model.getLineCount();
			this.excerptDecorations = this.editor.createDecorationsCollection();
			this.matchDecorations = this.editor.createDecorationsCollection(item.matches.map(range => ({ range, options: MATCH_DECORATION })));
			this.applyExcerpts(clampExcerpts(item.excerpts.get(), item.lineCount), undefined);
			const first = item.matches[0];
			if (item.selections) {
				this.editor.setSelections(item.selections);
			} else if (first) {
				this.editor.setPosition({ lineNumber: first.startLineNumber, column: first.startColumn });
			}
		} finally {
			this.isUpdatingEditor = false;
		}

		this.attachedStore.add(this.editor.onDidChangeModelContent(() => this.onDidChangeModelContent()));
		this.attachedStore.add(runOnChange(this.template.host.matchLinesOnly, () => this.onDidChangeMatchLinesOnly()));

		const findDecorations = this.findDecorations = this.editor.createDecorationsCollection();
		this.attachedStore.add(autorun(reader => {
			const state = this.template.host.findDecorations.read(reader);
			const current = state?.current?.item === item ? state.current.range : undefined;
			findDecorations.set((state?.matches.get(item) ?? []).map(range => ({
				range,
				options: current && range.equalsRange(current) ? FindDecorations._CURRENT_FIND_MATCH_DECORATION : FindDecorations._FIND_MATCH_NO_OVERVIEW_DECORATION,
			})));
		}));

		this.template.host.reportLineHeight(this.editor.getOption(EditorOption.lineHeight));
		this.observedEditorHeight = this.editor.getContentHeight();
		this.heightUpdate.clear();
		this.editorHeight.set(this.observedEditorHeight, undefined);
		this.template.host.onDidAttach(this);
	}

	private detach(): void {
		this.heightUpdate.clear();
		// The view zones and hidden areas go with the view of the model; the separators and decorations would stay
		this.separators.clear();
		this.attachedStore.clear();
		this.excerptDecorations?.clear();
		this.matchDecorations?.clear();
		this.findDecorations?.clear();
		this.zoneIds = [];
		this.excerptDecorations = undefined;
		this.matchDecorations = undefined;
		this.findDecorations = undefined;
		this.model = undefined;
		this.editor.setModel(null);
		this.modelStore.clear();
	}

	/** Keeps the excerpts on the lines they showed when the file changes, such as in another editor or on disk. */
	private onDidChangeModelContent(): void {
		const model = this.model;
		if (!model || !this.excerptDecorations || !this.matchDecorations) {
			return;
		}
		this.template.host.notifyFileContentChanged(this.item);
		const lineCount = model.getLineCount();
		const excerpts = clampExcerpts(this.excerptDecorations.getRanges().map(range => ({ startLineNumber: range.startLineNumber, endLineNumber: range.endLineNumber })), lineCount);
		this.item.matches = this.matchDecorations.getRanges();
		// The lines with matches alone change with the matches, which the excerpts may not
		if (lineCount === this.item.lineCount && excerptsEqual(excerpts, this.item.excerpts.get()) && !this.template.host.matchLinesOnly.get()) {
			return;
		}
		this.item.lineCount = lineCount;
		this.isUpdatingEditor = true;
		try {
			this.applyExcerpts(excerpts, undefined);
		} finally {
			this.isUpdatingEditor = false;
		}
	}

	/** Sets the excerpts of the file, which it keeps on their lines as the file changes, and shows them. */
	private applyExcerpts(excerpts: readonly IMultibufferExcerpt[], tx: ITransaction | undefined): void {
		const model = this.model;
		if (!model) {
			return;
		}
		this.item.excerpts.set(excerpts, tx);
		this.excerptDecorations?.set(excerpts.map(excerpt => ({
			range: new Range(excerpt.startLineNumber, 1, excerpt.endLineNumber, model.getLineMaxColumn(excerpt.endLineNumber)),
			options: EXCERPT_DECORATION,
		})));
		this.showExcerpts();
	}

	/**
	 * Hides the lines the file does not show, and puts a separator in place of each run of them. The lines with matches
	 * alone go without separators, as a list of them.
	 */
	private showExcerpts(): void {
		const model = this.model;
		if (!model) {
			return;
		}
		const matchLinesOnly = this.template.host.matchLinesOnly.get();
		const gaps = computeExcerptGaps(this.item.getShownExcerpts(matchLinesOnly), model.getLineCount());
		this.gaps = matchLinesOnly ? [] : gaps;
		this.editor.setHiddenAreas(gaps.map(gap => new Range(gap.startLineNumber, 1, gap.endLineNumber, 1)), HIDDEN_AREAS_SOURCE);

		this.separators.clear();
		const expandLines = this.template.host.expandLines.get();
		const zones = this.gaps.map(gap => {
			const zone = new PlaceholderViewZone(constObservable(gap.startLineNumber - 1), MULTIBUFFER_SEPARATOR_HEIGHT);
			this.separators.add(new MultibufferExcerptSeparator(this.editor, zone, gap, (direction, lines) => this.expandGap(gap, direction, lines), expandLines));
			return zone;
		});
		this.editor.changeViewZones(accessor => {
			this.zoneIds.forEach(id => accessor.removeZone(id));
			this.zoneIds = zones.map(zone => accessor.addZone(zone));
		});
	}

	private onDidChangeMatchLinesOnly(): void {
		const model = this.model;
		if (!model) {
			return;
		}
		this.isUpdatingEditor = true;
		try {
			this.showExcerpts();
			const position = this.editor.getPosition();
			const shown = this.item.getShownExcerpts(this.template.host.matchLinesOnly.get());
			const index = position ? findExcerptIndex(shown, position.lineNumber) : undefined;
			if (position && index !== undefined && (position.lineNumber < shown[index].startLineNumber || position.lineNumber > shown[index].endLineNumber)) {
				const lineNumber = Math.min(Math.max(position.lineNumber, shown[index].startLineNumber), shown[index].endLineNumber);
				const match = this.item.matches.find(range => range.startLineNumber === lineNumber);
				this.editor.setPosition({ lineNumber, column: match?.startColumn ?? 1 });
			}
		} finally {
			this.isUpdatingEditor = false;
		}
		// The multibuffer lays the files out again at once, for the file it keeps in place to stay there
		this.heightUpdate.clear();
		this.observedEditorHeight = this.editor.getContentHeight();
		this.editorHeight.set(this.observedEditorHeight, undefined);
	}

	/**
	 * Shows `lines` more of the hidden lines of `gap`, next to the excerpt below it (`up`) or above it (`down`). The
	 * separator stays where it is on screen: the excerpt that grows moves away from it.
	 */
	private expandGap(gap: IMultibufferExcerptGap, direction: 'up' | 'down', lines: number): void {
		const index = direction === 'up' ? gap.below : gap.above;
		if (index === undefined || !this.gaps.includes(gap)) {
			return;
		}
		const excerpts = this.item.excerpts.get();
		let getAnchor: () => number;
		if (direction === 'up') {
			// What is above the separator does not move
			const above = gap.above === undefined ? undefined : excerpts[gap.above].endLineNumber;
			getAnchor = above === undefined ? () => 0 : () => this.getLineOffset(above);
		} else {
			// What is below the separator moves down by as much as the excerpt above grows, but stays put on screen
			const below = gap.below === undefined ? undefined : excerpts[gap.below].startLineNumber;
			getAnchor = below === undefined ? () => this.size.get() : () => this.getLineOffset(below);
		}
		this.expand(index, direction, lines, getAnchor);
	}

	/** The top of `lineNumber` in the file, from the top of its header. */
	private getLineOffset(lineNumber: number): number {
		return MULTIBUFFER_FILE_HEADER_HEIGHT + this.editor.getTopForLineNumber(lineNumber);
	}

	/** The top of the line of a position in the file, from the top of its header. */
	private getPositionOffset(lineNumber: number, column: number): number {
		return MULTIBUFFER_FILE_HEADER_HEIGHT + this.editor.getTopForPosition(lineNumber, column);
	}

	/** Grows the excerpt at `index` by `lines` lines up or down, with the part of the file at `getAnchor` staying on screen. */
	private expand(index: number, direction: 'up' | 'down', lines: number, getAnchor: () => number): void {
		const model = this.model;
		const excerpts = this.item.excerpts.get();
		if (!model || this.item.collapsed.get() || this.template.host.matchLinesOnly.get() || !excerpts[index]) {
			return;
		}
		const expanded = expandExcerpt(excerpts, index, direction, lines, model.getLineCount());
		if (excerptsEqual(expanded, excerpts)) {
			return;
		}
		this.context.runWithScrollAnchor(
			getAnchor,
			tx => {
				this.isUpdatingEditor = true;
				try {
					this.applyExcerpts(expanded, tx);
				} finally {
					this.isUpdatingEditor = false;
				}
				this.heightUpdate.clear();
				this.observedEditorHeight = this.editor.getContentHeight();
				this.editorHeight.set(this.observedEditorHeight, tx);
			},
		);
	}

	private computeEditorOptions(): IEditorOptions {
		const configuration = this.textResourceConfigurationService.getValue<{ editor?: IEditorOptions; problems?: { visibility?: boolean } }>(this.item.resource);
		const options: IEditorOptions = isObject(configuration?.editor) ? deepClone(configuration.editor) : {};
		return {
			...options,
			readOnly: true,
			// Read-only editors hide the problems of the file otherwise
			renderValidationDecorations: configuration?.problems?.visibility !== false ? 'on' : 'off',
			scrollBeyondLastLine: false,
			scrollbar: {
				...options.scrollbar,
				vertical: 'hidden',
				horizontal: 'hidden',
				handleMouseWheel: false,
				useShadows: false,
			},
			overviewRulerLanes: 0,
			overviewRulerBorder: false,
			minimap: { enabled: false },
			// Folding and sticky scroll would hide lines of the excerpts, or cover them
			folding: false,
			stickyScroll: { enabled: false },
			fixedOverflowWidgets: true,
			automaticLayout: false,
			lineNumbersMinChars: 3,
		};
	}

	private scheduleHeightUpdate(): void {
		if (!this.heightUpdate.value) {
			this.heightUpdate.value = scheduleAtNextAnimationFrame(getWindow(this.template.elements.root), () => this.flushHeight());
		}
	}

	private flushHeight(): void {
		this.heightUpdate.clear();
		if (this.model && this.editorHeight.get() !== this.observedEditorHeight) {
			this.editorHeight.set(this.observedEditorHeight, undefined);
		}
	}
}

/** The separator in place of a run of hidden lines, with the actions that show more of them. */
class MultibufferExcerptSeparator extends ViewZoneOverlayWidget {
	constructor(
		editor: ICodeEditor,
		zone: PlaceholderViewZone,
		gap: IMultibufferExcerptGap,
		expand: (direction: 'up' | 'down', lines: number) => void,
		expandLines: number,
	) {
		const elements = h('div.vsade-multibuffer-separator', [
			h('div.vsade-multibuffer-separator-actions@actions'),
			h('div.vsade-multibuffer-separator-label@label'),
		]);
		super(editor, zone, elements.root);

		const hiddenLines = gap.endLineNumber - gap.startLineNumber + 1;
		const actionBar = this._register(new ActionBar(elements.actions));
		if (gap.above !== undefined) {
			actionBar.push(this._register(new Action('vsade.multibuffer.separator.expandDown', localize('multibuffer.expandDown', "Show Lines Below"), ThemeIcon.asClassName(Codicon.foldDown), true, async () => expand('down', expandLines))), { icon: true, label: false });
		}
		if (gap.below !== undefined) {
			actionBar.push(this._register(new Action('vsade.multibuffer.separator.expandUp', localize('multibuffer.expandUp', "Show Lines Above"), ThemeIcon.asClassName(Codicon.foldUp), true, async () => expand('up', expandLines))), { icon: true, label: false });
		}

		elements.label.textContent = hiddenLines === 1
			? localize('multibuffer.oneHiddenLine', "1 hidden line")
			: localize('multibuffer.hiddenLines', "{0} hidden lines", hiddenLines);
		elements.label.setAttribute('role', 'button');
		elements.label.tabIndex = 0;
		const showAll = () => expand(gap.above !== undefined ? 'down' : 'up', hiddenLines);
		this._register(addDisposableListener(elements.label, EventType.CLICK, showAll));
		this._register(addDisposableListener(elements.label, EventType.KEY_DOWN, e => {
			if (e.key === 'Enter' || e.key === ' ') {
				e.preventDefault();
				showAll();
			}
		}));
	}
}
