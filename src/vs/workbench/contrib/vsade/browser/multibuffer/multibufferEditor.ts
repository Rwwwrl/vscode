/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, Dimension, EventType, h, isAncestor } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { RunOnceScheduler } from '../../../../../base/common/async.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Emitter } from '../../../../../base/common/event.js';
import { KeyCode } from '../../../../../base/common/keyCodes.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { autorun, observableValue, runOnChange } from '../../../../../base/common/observable.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { ICompositeCodeEditor } from '../../../../../editor/common/editorCommon.js';
import { localize } from '../../../../../nls.js';
import { MenuWorkbenchToolBar } from '../../../../../platform/actions/browser/toolbar.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService, IScopedContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { ContextScopedFindInput } from '../../../../../platform/history/browser/contextScopedHistoryWidget.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { ServiceCollection } from '../../../../../platform/instantiation/common/serviceCollection.js';
import { observableConfigValue } from '../../../../../platform/observable/common/platformObservableUtils.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { ITelemetryService } from '../../../../../platform/telemetry/common/telemetry.js';
import { defaultInputBoxStyles, defaultToggleStyles } from '../../../../../platform/theme/browser/defaultStyles.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { EditorPane } from '../../../../browser/parts/editor/editorPane.js';
import { IEditorOpenContext } from '../../../../common/editor.js';
import { IEditorGroup } from '../../../../services/editor/common/editorGroupsService.js';
import { IMultibufferOpenFileContext, IMultibufferTextQuery, MULTIBUFFER_EDITOR_ID, MultibufferContext, MultibufferHeaderToolbarMenu, MultibufferMatchLinesOnlyContext, MultibufferSettingId } from '../../common/multibuffer/multibuffer.js';
import { MultibufferEditorInput } from './multibufferEditorInput.js';
import { MultibufferFindWidget } from './multibufferFindWidget.js';
import { MultibufferModel } from './multibufferModel.js';
import { MultibufferWidget } from './multibufferWidget.js';
import './media/multibuffer.css';

/** The height of the row above the files of a multibuffer, which tells what it shows. */
const SUMMARY_HEIGHT = 26;

/** The height of that row in a text search multibuffer, which holds the input of its query too. */
const SEARCH_HEADER_HEIGHT = 36;

/** How long a text search multibuffer waits after the query was typed before it searches. */
const SEARCH_ON_TYPE_DELAY = 300;

/**
 * The editor of multibuffers. Its control is the editor of the file with the focus, so that the commands of the active
 * editor, such as Go to Definition or the status bar, work on that file.
 */
export class MultibufferEditor extends EditorPane {

	static readonly ID = MULTIBUFFER_EDITOR_ID;

	private static readonly instances = new Set<MultibufferEditor>();

	/** The multibuffer that shows `editor` as one of its files. */
	static forCodeEditor(editor: ICodeEditor): MultibufferEditor | undefined {
		const node = editor.getContainerDomNode();
		for (const instance of MultibufferEditor.instances) {
			if (instance.root && isAncestor(node, instance.root)) {
				return instance;
			}
		}
		return undefined;
	}

	private readonly dimension = observableValue<Dimension | undefined>(this, undefined);
	private readonly model = observableValue<MultibufferModel | undefined>(this, undefined);
	private readonly _onDidChangeActiveEditor = this._register(new Emitter<ICompositeCodeEditor>());

	private root: HTMLElement | undefined;
	private header: HTMLElement | undefined;
	private searchInput: ContextScopedFindInput | undefined;
	private widget: MultibufferWidget | undefined;
	private findWidget: MultibufferFindWidget | undefined;
	private contextKeyServiceOfPane: IScopedContextKeyService | undefined;
	private lastDimension: Dimension | undefined;
	private readonly searchOnType = this._register(new RunOnceScheduler(() => this.runSearch(), SEARCH_ON_TYPE_DELAY));

	constructor(
		group: IEditorGroup,
		@ITelemetryService telemetryService: ITelemetryService,
		@IThemeService themeService: IThemeService,
		@IStorageService storageService: IStorageService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
		@IContextKeyService private readonly contextKeyService: IContextKeyService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IContextViewService private readonly contextViewService: IContextViewService,
	) {
		super(MultibufferEditor.ID, group, telemetryService, themeService, storageService);
		MultibufferEditor.instances.add(this);
		this._register(toDisposable(() => MultibufferEditor.instances.delete(this)));
	}

	/**
	 * The context of the editor of the file with the focus, as a text editor gives its own, so that the Command Palette
	 * offers the commands of that file; else the context of the multibuffer, which the editors of its files inherit.
	 */
	override get scopedContextKeyService(): IContextKeyService | undefined {
		return this.widget?.activeEditor.get()?.invokeWithinContext(accessor => accessor.get(IContextKeyService)) ?? this.contextKeyServiceOfPane;
	}

	private get multibufferInput(): MultibufferEditorInput | undefined {
		return this.input instanceof MultibufferEditorInput ? this.input : undefined;
	}

	protected createEditor(parent: HTMLElement): void {
		const elements = h('div.vsade-multibuffer', [
			h('div.vsade-multibuffer-header@header', [
				h('div.vsade-multibuffer-actions@actions'),
				h('div.vsade-multibuffer-search@search'),
				h('div.vsade-multibuffer-summary@summary'),
			]),
			h('div.vsade-multibuffer-body@body'),
		]);
		this.root = elements.root;
		this.header = elements.header;
		parent.appendChild(elements.root);

		// The editors of the files get this context as their parent, so its keys hold in them too
		this.contextKeyServiceOfPane = this._register(this.contextKeyService.createScoped(elements.root));
		MultibufferContext.bindTo(this.contextKeyServiceOfPane).set(true);
		const instantiationService = this._register(this.instantiationService.createChild(new ServiceCollection([IContextKeyService, this.contextKeyServiceOfPane])));

		const expandLines = observableConfigValue(MultibufferSettingId.ExpandLines, 20, this.configurationService);
		const widget = this.widget = this._register(instantiationService.createInstance(MultibufferWidget, elements.body, this.dimension, this.model, expandLines));

		this.findWidget = this._register(instantiationService.createInstance(MultibufferFindWidget, widget, () => this.widget?.focus()));
		elements.body.appendChild(this.findWidget.getDomNode());

		this.createSearchInput(elements.search);

		const matchLinesOnly = MultibufferMatchLinesOnlyContext.bindTo(this.contextKeyServiceOfPane);
		this._register(autorun(reader => matchLinesOnly.set(this.model.read(reader)?.matchLinesOnly.read(reader) ?? false)));
		this._register(instantiationService.createInstance(MenuWorkbenchToolBar, elements.actions, MultibufferHeaderToolbarMenu, {}));

		this._register(runOnChange(widget.activeEditor, () => {
			this._onDidChangeActiveEditor.fire(this.getControl());
			this._onDidChangeControl.fire();
		}));

		this._register(autorun(reader => {
			const model = this.model.read(reader);
			if (!model) {
				elements.summary.textContent = '';
				return;
			}
			const matches = model.matchCount.read(reader);
			const files = model.items.read(reader).length;
			const message = model.message.read(reader);
			let summary: string;
			if (model.isLoading.read(reader)) {
				summary = localize('multibuffer.searching', "Searching...");
			} else if (message) {
				summary = message;
			} else if (model.limitHit.read(reader)) {
				summary = localize('multibuffer.summaryLimitHit', "{0} matches in {1} files (more were not shown: see vsade.multibuffer.maxResults)", matches, files);
			} else {
				summary = localize('multibuffer.summary', "{0} matches in {1} files", matches, files);
			}
			elements.summary.textContent = this.multibufferInput?.search ? summary : localize('multibuffer.summaryWithTitle', "{0}: {1}", model.title.read(reader), summary);
		}));
	}

	/** The input of the query of a text search multibuffer: it searches as it is typed, and at once on Enter. */
	private createSearchInput(container: HTMLElement): void {
		const searchInput = this.searchInput = this._register(new ContextScopedFindInput(container, this.contextViewService, {
			label: localize('multibuffer.searchInput', "Search"),
			placeholder: localize('multibuffer.searchPlaceholder', "Search the workspace"),
			showCommonFindToggles: true,
			inputBoxStyles: defaultInputBoxStyles,
			toggleStyles: defaultToggleStyles,
		}, this.contextKeyServiceOfPane!));
		this._register(searchInput.onInput(() => this.searchOnType.schedule()));
		this._register(searchInput.onDidOptionChange(() => this.runSearch()));
		this._register(addDisposableListener(searchInput.inputBox.inputElement, EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter)) {
				event.preventDefault();
				this.runSearch();
			}
		}));
	}

	private runSearch(): void {
		this.searchOnType.cancel();
		const search = this.multibufferInput?.search;
		const searchInput = this.searchInput;
		if (!search || !searchInput) {
			return;
		}
		const query: IMultibufferTextQuery = {
			pattern: searchInput.getValue(),
			isRegExp: searchInput.getRegex(),
			isCaseSensitive: searchInput.getCaseSensitive(),
			isWordMatch: searchInput.getWholeWords(),
		};
		const current = search.query.get();
		if (current.pattern === query.pattern && current.isRegExp === query.isRegExp && current.isCaseSensitive === query.isCaseSensitive && current.isWordMatch === query.isWordMatch) {
			return;
		}
		searchInput.inputBox.addToHistory();
		void search.run(query);
	}

	override async setInput(input: MultibufferEditorInput, options: IEditorOptions | undefined, context: IEditorOpenContext, token: CancellationToken): Promise<void> {
		this.saveViewState();
		this.findWidget?.hide(false);
		await super.setInput(input, options, context, token);

		this.searchOnType.cancel();
		const query = input.search?.query.get();
		this.header?.classList.toggle('search', !!input.search);
		if (query && this.searchInput) {
			this.searchInput.setValue(query.pattern);
			this.searchInput.setRegex(query.isRegExp);
			this.searchInput.setCaseSensitive(query.isCaseSensitive);
			this.searchInput.setWholeWords(query.isWordMatch);
		}
		this.model.set(input.model, undefined);
		this.widget?.setViewState(input.viewState);
		this.relayout();
	}

	override clearInput(): void {
		this.saveViewState();
		this.findWidget?.hide(false);
		this.searchOnType.cancel();
		this.model.set(undefined, undefined);
		super.clearInput();
	}

	private saveViewState(): void {
		const input = this.multibufferInput;
		if (input && this.widget) {
			input.viewState = this.widget.getViewState();
		}
	}

	layout(dimension: Dimension): void {
		this.lastDimension = dimension;
		this.relayout();
	}

	private relayout(): void {
		const dimension = this.lastDimension;
		if (!dimension) {
			return;
		}
		const headerHeight = this.multibufferInput?.search ? SEARCH_HEADER_HEIGHT : SUMMARY_HEIGHT;
		if (this.header) {
			this.header.style.height = `${headerHeight}px`;
		}
		this.dimension.set(new Dimension(dimension.width, Math.max(0, dimension.height - headerHeight)), undefined);
		this.findWidget?.layout(dimension.width);
	}

	override getControl(): ICompositeCodeEditor {
		return {
			activeCodeEditor: this.widget?.activeEditor.get(),
			onDidChangeActiveEditor: this._onDidChangeActiveEditor.event,
		};
	}

	/** The file and selection that the commands that open the file of an excerpt act on, without a file of their own. */
	getActiveOpenFileContext(): IMultibufferOpenFileContext | undefined {
		return this.widget?.activeBinding.get()?.getOpenFileContext();
	}

	/** Shows only the lines with matches, as a list of them, or the excerpts around them again. */
	setMatchLinesOnly(matchLinesOnly: boolean): void {
		this.widget?.setMatchLinesOnly(matchLinesOnly);
	}

	/** Grows the excerpt with the cursor of the active file. */
	expandActiveExcerpt(direction: 'up' | 'down'): void {
		this.widget?.activeBinding.get()?.expandAtCursor(direction);
	}

	/**
	 * Shows the find of the multibuffer, which finds in all of its files. It starts from the selection of the file with
	 * the focus, or the word at its cursor, as the find of an editor does.
	 */
	startFind(): void {
		this.findWidget?.reveal(this.getFindSeed());
	}

	findNext(): void {
		this.startFindIfHidden();
		this.findWidget?.find(false);
	}

	findPrevious(): void {
		this.startFindIfHidden();
		this.findWidget?.find(true);
	}

	closeFind(): void {
		this.findWidget?.hide();
	}

	/** Focuses the input of the query of a text search multibuffer. */
	focusSearchInput(): void {
		this.searchInput?.focus();
		this.searchInput?.select();
	}

	/**
	 * Focuses the files, as switching to any editor focuses its text, so that the keybindings of editors work in them
	 * at once, such as those that move between editors. The query of a text search takes the focus instead while there
	 * is nothing else to focus: no query yet, or no results.
	 */
	override focus(): void {
		super.focus();
		const input = this.multibufferInput;
		const hasNothingToShow = !input?.model.isLoading.get() && input?.model.items.get().length === 0;
		if (input?.search && (!input.search.query.get().pattern || hasNothingToShow)) {
			this.focusSearchInput();
		} else {
			this.widget?.focus();
		}
	}

	override hasFocus(): boolean {
		return (this.widget?.hasFocus() ?? false) || super.hasFocus();
	}

	private startFindIfHidden(): void {
		if (this.findWidget && !this.findWidget.isVisible()) {
			this.startFind();
		}
	}

	private getFindSeed(): string | undefined {
		const editor = this.widget?.activeEditor.get();
		const model = editor?.getModel();
		const selection = editor?.getSelection();
		if (!editor?.hasWidgetFocus() || !model || !selection) {
			return undefined;
		}
		if (selection.isEmpty()) {
			return model.getWordAtPosition(selection.getPosition())?.word;
		}
		return selection.startLineNumber === selection.endLineNumber ? model.getValueInRange(selection) : undefined;
	}
}
