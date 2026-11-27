/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Dimension, h, isActiveElement } from '../../../../../base/browser/dom.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { CancellationToken, CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { autorun, constObservable, derived, IObservable, observableValue } from '../../../../../base/common/observable.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { CompressedVirtualizedScrollView } from '../../../../../editor/browser/widget/multiDiffEditor/compressedVirtualizedScrollView.js';
import { ManagedVirtualizedItem, VirtualizedItemManager } from '../../../../../editor/browser/widget/multiDiffEditor/virtualizedItemManager.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { estimateExcerptsHeight, estimateLineTop } from '../../common/multibuffer/multibufferExcerpts.js';
import { IMultibufferViewState } from './multibufferEditorInput.js';
import { IMultibufferFileHost, IMultibufferFindDecorations, MULTIBUFFER_FILE_HEADER_HEIGHT, MULTIBUFFER_SEPARATOR_HEIGHT, MultibufferFileBinding, MultibufferFileTemplate } from './multibufferFileTemplate.js';
import { MultibufferFileItem, MultibufferModel } from './multibufferModel.js';

/** The line height to estimate the height of the files with before an editor told the real one. */
const DEFAULT_LINE_HEIGHT = 18;

/** How far from the viewport, in viewports, the files load before they scroll into it. */
const PRELOAD_DISTANCE = 1.5;

/** How far from the viewport, in viewports, a file that loaded ahead is let go of again. */
const RELEASE_DISTANCE = 4;

/** The most files the multibuffer loads ahead at once, apart from those on screen. */
const MAX_PRELOADED_FILES = 40;

/** How often, at most, the multibuffer looks for files to load ahead as it scrolls. */
const PRELOAD_INTERVAL = 50;

type ManagedFile = ManagedVirtualizedItem<MultibufferFileItem, MultibufferFileBinding, MultibufferFileTemplate>;

/**
 * The files of a multibuffer in one scroll. Only the files on screen have an editor: a pool of them moves from file to
 * file as the multibuffer scrolls, and each file keeps its place in the scroll by the height its editor last had.
 */
export class MultibufferWidget extends Disposable implements IMultibufferFileHost {

	private readonly scrollView: CompressedVirtualizedScrollView<ManagedFile>;
	private readonly files: IObservable<readonly ManagedFile[]>;
	private readonly lineHeight = observableValue(this, DEFAULT_LINE_HEIGHT);
	private readonly activeItem = observableValue<MultibufferFileItem | undefined>(this, undefined);
	private readonly _findDecorations = observableValue<IMultibufferFindDecorations | undefined>(this, undefined);
	readonly findDecorations: IObservable<IMultibufferFindDecorations | undefined> = this._findDecorations;
	private readonly _onDidChangeFileContent = this._register(new Emitter<MultibufferFileItem>());
	/** A file changed while the multibuffer showed it. */
	readonly onDidChangeFileContent: Event<MultibufferFileItem> = this._onDidChangeFileContent.event;

	/** A range to reveal once the editor of its file loaded it, such as a match of the find in a file not shown yet. */
	private pendingReveal: { readonly item: MultibufferFileItem; readonly range: Range } | undefined;

	private readonly root: HTMLElement;
	/** Whether the first file to load takes the focus, which the multibuffer holds until then. */
	private focusPending = false;

	/** The models of the files near the viewport, loaded ahead of their editors. */
	private readonly preloaded = this._register(new DisposableMap<MultibufferFileItem>());
	private readonly preloadScheduler = this._register(new RunOnceScheduler(() => this.preload(), PRELOAD_INTERVAL));

	/** The files of the multibuffer. */
	readonly items: IObservable<readonly MultibufferFileItem[]>;

	/** Whether the files show only the lines with matches instead of their excerpts. */
	readonly matchLinesOnly: IObservable<boolean>;

	/** The editor of the file that had the focus last, while it shows that file. */
	readonly activeEditor: IObservable<ICodeEditor | undefined>;

	/** The binding of the file that had the focus last, while it is bound. */
	readonly activeBinding: IObservable<MultibufferFileBinding | undefined>;

	constructor(
		element: HTMLElement,
		dimension: IObservable<Dimension | undefined>,
		private readonly model: IObservable<MultibufferModel | undefined>,
		readonly expandLines: IObservable<number>,
		@IInstantiationService instantiationService: IInstantiationService,
		@ITextModelService private readonly textModelService: ITextModelService,
	) {
		super();

		this.items = derived(this, reader => model.read(reader)?.items.read(reader) ?? []);
		this.matchLinesOnly = derived(this, reader => model.read(reader)?.matchLinesOnly.read(reader) ?? false);
		let files!: IObservable<readonly ManagedFile[]>;
		// What the scroll view renders is disposed after it, as the multi-diff editor does: disposing it first would make
		// the scroll view render once more, and create templates while the widget disposes
		const renderedItemsStore = new DisposableStore();
		this.scrollView = this._register(new CompressedVirtualizedScrollView<ManagedFile>(
			element,
			dimension,
			constObservable(0),
			context => {
				const manager = renderedItemsStore.add(new VirtualizedItemManager<MultibufferFileItem, MultibufferFileBinding, MultibufferFileTemplate>(this.items, context, {
					getId: item => item,
					getTemplateId: () => 'file',
					getUnboundSize: item => derived(this, reader => {
						if (item.collapsed.read(reader)) {
							return MULTIBUFFER_FILE_HEADER_HEIGHT;
						}
						// The lines with matches alone have no separators between them, and are as high as they are many
						if (this.matchLinesOnly.read(reader)) {
							return MULTIBUFFER_FILE_HEADER_HEIGHT + estimateExcerptsHeight(item.getShownExcerpts(true), item.lineCount, this.lineHeight.read(reader), 0);
						}
						const editorHeight = item.measuredEditorHeight.read(reader)
							?? estimateExcerptsHeight(item.excerpts.read(reader), item.lineCount, this.lineHeight.read(reader), MULTIBUFFER_SEPARATOR_HEIGHT);
						return MULTIBUFFER_FILE_HEADER_HEIGHT + editorHeight;
					}),
					createTemplate: () => instantiationService.createInstance(MultibufferFileTemplate, context.contentDomNode, context.overflowWidgetsDomNode, context.scrollLeft, this),
					onWillUnbind: (binding, tx) => {
						const editorHeight = binding.getEditorHeight();
						// The height of the excerpts, for when the multibuffer shows them again
						if (editorHeight !== undefined && !this.matchLinesOnly.get()) {
							binding.item.measuredEditorHeight.set(editorHeight, tx);
						}
						binding.item.selections = binding.getSelections() ?? binding.item.selections;
					},
				}));
				files = manager.virtualizedItems;
				return files;
			},
		));
		this._register(renderedItemsStore);
		this.files = files;

		this.activeBinding = derived(this, reader => {
			const item = this.activeItem.read(reader);
			return item ? this.files.read(reader).find(file => file.item === item)?.binding.read(reader) : undefined;
		});
		this.activeEditor = this.activeBinding.map(binding => binding?.editor);

		// The active file of a previous model is not one of the files of the next
		this._register(autorun(reader => {
			const items = model.read(reader)?.items.read(reader) ?? [];
			const active = this.activeItem.read(undefined);
			if (active && !items.includes(active)) {
				this.activeItem.set(undefined, undefined);
			}
		}));

		// The files near the viewport load before they scroll into it, so that their editors show them at once
		this._register(autorun(reader => {
			this.scrollView.layout.read(reader);
			this.items.read(reader);
			if (!this.preloadScheduler.isScheduled()) {
				this.preloadScheduler.schedule();
			}
		}));

		const root = this.root = h('div.vsade-multibuffer-files', [this.scrollView.domNode]).root;
		// It holds the focus until a file loads, for the editor of that file to take it then
		root.tabIndex = -1;
		element.replaceChildren(root);
		this._register(toDisposable(() => element.replaceChildren()));
	}

	getViewState(): IMultibufferViewState {
		const position = this.scrollView.getScrollPosition();
		return { scrollTop: position.scrollTop, scrollLeft: position.scrollLeft };
	}

	setViewState(viewState: IMultibufferViewState | undefined): void {
		this.scrollView.setScrollPosition({ scrollTop: viewState?.scrollTop ?? 0, scrollLeft: viewState?.scrollLeft ?? 0 });
	}

	/**
	 * Focuses the editor of the file that had the focus last, or of the first file on screen. While that file is not
	 * loaded yet, such as right after the multibuffer opened, the multibuffer holds the focus and hands it to the first
	 * file that loads, so that the keybindings of editors work in it as soon as they can.
	 */
	focus(): void {
		const binding = this.activeBinding.get() ?? this.files.get().map(file => file.binding.get()).find(binding => binding !== undefined);
		if (binding?.isAttached) {
			this.focusPending = false;
			binding.focus();
			return;
		}
		this.focusPending = true;
		this.root.focus();
	}

	hasFocus(): boolean {
		return (this.activeEditor.get()?.hasWidgetFocus() ?? false) || isActiveElement(this.root);
	}

	/**
	 * Shows only the lines with matches, or the excerpts around them again, as they were. The file with the focus, or
	 * else the file at the top of the viewport, moves to the top of it.
	 */
	setMatchLinesOnly(matchLinesOnly: boolean): void {
		const multibuffer = this.model.get();
		if (!multibuffer || multibuffer.matchLinesOnly.get() === matchLinesOnly) {
			return;
		}
		const layout = this.scrollView.layout.get();
		const items = this.items.get();
		const active = this.activeBinding.get();
		const activeIndex = active && this.hasFocus() ? items.indexOf(active.item) : -1;
		const anchorIndex = activeIndex !== -1 ? activeIndex : layout.items.findIndex(itemLayout => itemLayout.contentRange.endExclusive > layout.contentViewport.start);
		multibuffer.matchLinesOnly.set(matchLinesOnly, undefined);
		const anchor = anchorIndex === -1 ? undefined : this.scrollView.layout.get().items[anchorIndex];
		if (anchor) {
			this.scrollView.setLogicalScrollPosition(anchor.contentRange.start);
		}
		if (activeIndex !== -1 && active?.isAttached) {
			active.revealCursor();
		}
	}

	setFindDecorations(decorations: IMultibufferFindDecorations | undefined): void {
		this._findDecorations.set(decorations, undefined);
	}

	/**
	 * Selects `range` of the file of `item` and scrolls to it. A file that is not shown yet is scrolled to where the
	 * range is estimated to be, and the range is selected once its editor loaded the file.
	 */
	revealRange(item: MultibufferFileItem, range: Range): void {
		if (item.collapsed.get()) {
			item.collapsed.set(false, undefined);
		}
		this.activeItem.set(item, undefined);
		const binding = this.files.get().find(file => file.item === item)?.binding.get();
		if (binding?.isAttached) {
			this.pendingReveal = undefined;
			binding.revealRange(range);
			return;
		}
		this.pendingReveal = { item, range };
		const matchLinesOnly = this.matchLinesOnly.get();
		const top = MULTIBUFFER_FILE_HEADER_HEIGHT + estimateLineTop(item.getShownExcerpts(matchLinesOnly), range.startLineNumber, this.lineHeight.get(), matchLinesOnly ? 0 : MULTIBUFFER_SEPARATOR_HEIGHT);
		this.revealCentered(item, top, top + this.lineHeight.get());
	}

	/** Where the cursor of the file with the focus is, by the index of the file. */
	getActivePosition(): { readonly fileIndex: number; readonly range: Range } | undefined {
		const binding = this.activeBinding.get();
		const position = binding?.isAttached ? binding.editor.getPosition() : undefined;
		const fileIndex = binding ? this.items.get().indexOf(binding.item) : -1;
		return position && fileIndex !== -1 ? { fileIndex, range: Range.fromPositions(position) } : undefined;
	}

	/**
	 * Loads the models of the files within {@link PRELOAD_DISTANCE} viewports of the viewport, nearest first, and lets go
	 * of those beyond {@link RELEASE_DISTANCE} viewports.
	 */
	private preload(): void {
		const layout = this.scrollView.layout.get();
		const viewport = layout.contentViewport;
		const items = this.items.get();
		if (viewport.length === 0) {
			return;
		}
		const distanceOf = (index: number): number => {
			const range = layout.items[index]?.contentRange;
			if (!range) {
				return Number.POSITIVE_INFINITY;
			}
			return Math.max(0, viewport.start - range.endExclusive, range.start - viewport.endExclusive);
		};

		const indexes = new Map(items.map((item, index) => [item, index]));
		for (const item of [...this.preloaded.keys()]) {
			const index = indexes.get(item);
			if (index === undefined || distanceOf(index) > viewport.length * RELEASE_DISTANCE) {
				this.preloaded.deleteAndDispose(item);
			}
		}

		const candidates: { readonly item: MultibufferFileItem; readonly distance: number }[] = [];
		items.forEach((item, index) => {
			const distance = distanceOf(index);
			if (distance <= viewport.length * PRELOAD_DISTANCE && !item.collapsed.get() && !this.preloaded.has(item)) {
				candidates.push({ item, distance });
			}
		});
		candidates.sort((a, b) => a.distance - b.distance);
		for (const { item } of candidates) {
			if (this.preloaded.size >= MAX_PRELOADED_FILES) {
				break;
			}
			this.preloaded.set(item, this.loadModel(item));
		}
	}

	private loadModel(item: MultibufferFileItem): IDisposable {
		const store = new DisposableStore();
		const cts = new CancellationTokenSource();
		store.add(toDisposable(() => cts.dispose(true)));
		void this.acquireModel(item, store, cts.token);
		return store;
	}

	private async acquireModel(item: MultibufferFileItem, store: DisposableStore, token: CancellationToken): Promise<void> {
		try {
			const reference = await this.textModelService.createModelReference(item.resource);
			if (token.isCancellationRequested) {
				reference.dispose();
			} else {
				store.add(reference);
			}
		} catch {
			// The editor of the file tells why it cannot load it, once the file scrolls into the viewport
		}
	}

	//#region IMultibufferFileHost

	reportLineHeight(lineHeight: number): void {
		if (lineHeight > 0) {
			this.lineHeight.set(lineHeight, undefined);
		}
	}

	setActive(item: MultibufferFileItem): void {
		this.activeItem.set(item, undefined);
	}

	scrollBy(delta: number): void {
		const position = this.scrollView.getScrollPosition();
		this.scrollView.setScrollPosition({ scrollTop: position.scrollTop + delta });
	}

	revealCentered(item: MultibufferFileItem, top: number, bottom: number): void {
		const index = this.files.get().findIndex(file => file.item === item);
		const layout = this.scrollView.layout.get();
		const itemLayout = layout.items[index];
		if (!itemLayout) {
			return;
		}
		const viewport = layout.contentViewport;
		const absoluteTop = itemLayout.contentRange.start + top;
		const absoluteBottom = itemLayout.contentRange.start + bottom;
		if (absoluteTop - MULTIBUFFER_FILE_HEADER_HEIGHT >= viewport.start && absoluteBottom <= viewport.endExclusive) {
			return;
		}
		this.scrollView.setLogicalScrollPosition(Math.max(0, Math.round((absoluteTop + absoluteBottom - viewport.length) / 2)));
	}

	notifyFileContentChanged(item: MultibufferFileItem): void {
		this._onDidChangeFileContent.fire(item);
	}

	onDidAttach(binding: MultibufferFileBinding): void {
		const pending = this.pendingReveal;
		if (pending?.item === binding.item) {
			this.pendingReveal = undefined;
			binding.revealRange(pending.range);
		}
		const active = this.activeItem.get();
		if (this.focusPending && (!active || active === binding.item)) {
			this.focusPending = false;
			// Unless the focus moved elsewhere in the meantime
			if (isActiveElement(this.root)) {
				binding.focus();
			}
		}
	}

	reveal(item: MultibufferFileItem, top: number, bottom: number): void {
		const index = this.files.get().findIndex(file => file.item === item);
		const layout = this.scrollView.layout.get();
		const itemLayout = layout.items[index];
		if (!itemLayout) {
			return;
		}
		const viewport = layout.contentViewport;
		// The header of the file sticks to the top of the viewport, over the lines under it
		const absoluteTop = itemLayout.contentRange.start + top - MULTIBUFFER_FILE_HEADER_HEIGHT;
		const absoluteBottom = itemLayout.contentRange.start + bottom;
		if (absoluteTop < viewport.start) {
			this.scrollView.setLogicalScrollPosition(Math.max(0, absoluteTop));
		} else if (absoluteBottom > viewport.endExclusive) {
			this.scrollView.setLogicalScrollPosition(Math.max(0, absoluteBottom - viewport.length));
		}
	}

	//#endregion
}
