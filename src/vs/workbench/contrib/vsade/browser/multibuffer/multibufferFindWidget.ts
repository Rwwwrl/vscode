/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { addDisposableListener, EventType } from '../../../../../base/browser/dom.js';
import { StandardKeyboardEvent } from '../../../../../base/browser/keyboardEvent.js';
import { Limiter, RunOnceScheduler } from '../../../../../base/common/async.js';
import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { Emitter, Event } from '../../../../../base/common/event.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { Disposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { autorun } from '../../../../../base/common/observable.js';
import { splitLines } from '../../../../../base/common/strings.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { IAccessibilityService } from '../../../../../platform/accessibility/common/accessibility.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKey, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextViewService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { ITextFileService } from '../../../../services/textfile/common/textfiles.js';
import { SimpleFindWidget } from '../../../codeEditor/browser/find/simpleFindWidget.js';
import { MultibufferCommandId, MultibufferFindFocusedContext, MultibufferFindVisibleContext } from '../../common/multibuffer/multibuffer.js';
import { findInExcerpts, IMultibufferFindMatch, IMultibufferFindQuery, MULTIBUFFER_FIND_LIMIT, MultibufferFindModel, parseFindQuery } from '../../common/multibuffer/multibufferFind.js';
import { MultibufferFileItem } from './multibufferModel.js';
import { MultibufferWidget } from './multibufferWidget.js';

/** How many files the find reads at once, for the files that no editor has loaded. */
const READ_CONCURRENCY = 8;

/**
 * Finds in the lines that the files of a multibuffer show, in all of them: in the model of a file when an editor has
 * loaded it, else in its content on disk, read once while the find is open.
 */
class MultibufferFindController extends Disposable {

	private readonly findModel = new MultibufferFindModel();
	private query: IMultibufferFindQuery | undefined;
	private readonly snapshots = new Map<MultibufferFileItem, readonly string[]>();
	private readonly updateScheduler = this._register(new RunOnceScheduler(() => void this.update(), 100));
	private running: CancellationTokenSource | undefined;
	private revealOnUpdate = false;

	private readonly _onDidUpdate = this._register(new Emitter<void>());
	readonly onDidUpdate: Event<void> = this._onDidUpdate.event;

	constructor(
		private readonly widget: MultibufferWidget,
		@IModelService private readonly modelService: IModelService,
		@ITextFileService private readonly textFileService: ITextFileService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this._register(toDisposable(() => this.running?.dispose(true)));
		// The matches follow the lines the files show, such as after a new search, an expanded excerpt or the lines with matches alone
		this._register(autorun(reader => {
			widget.matchLinesOnly.read(reader);
			for (const item of widget.items.read(reader)) {
				item.excerpts.read(reader);
			}
			if (this.query) {
				this.updateScheduler.schedule();
			}
		}));
		this._register(widget.onDidChangeFileContent(item => {
			this.snapshots.delete(item);
			if (this.query) {
				this.updateScheduler.schedule();
			}
		}));
	}

	get count(): number {
		return this.findModel.matches.length;
	}

	get currentIndex(): number {
		return this.findModel.currentIndex;
	}

	/** Finds `query`, and moves to its first match after the cursor of the file with the focus. */
	async setQuery(query: IMultibufferFindQuery | undefined): Promise<void> {
		this.query = query?.searchString ? query : undefined;
		this.findModel.reset();
		this.revealOnUpdate = true;
		this.updateScheduler.cancel();
		await this.update();
	}

	async next(): Promise<void> {
		await this.flush();
		this.reveal(this.findModel.next(this.widget.getActivePosition()));
	}

	async previous(): Promise<void> {
		await this.flush();
		this.reveal(this.findModel.previous(this.widget.getActivePosition()));
	}

	clear(): void {
		this.query = undefined;
		this.updateScheduler.cancel();
		this.running?.dispose(true);
		this.running = undefined;
		this.findModel.reset();
		this.snapshots.clear();
		this.widget.setFindDecorations(undefined);
		this._onDidUpdate.fire();
	}

	private async flush(): Promise<void> {
		if (this.updateScheduler.isScheduled()) {
			this.updateScheduler.cancel();
			await this.update();
		}
	}

	private async update(): Promise<void> {
		this.running?.dispose(true);
		const cts = this.running = new CancellationTokenSource();
		const items = this.widget.items.get();
		const query = this.query;
		const searchData = query ? parseFindQuery(query, this.configurationService.getValue<string>('editor.wordSeparators') ?? '') : undefined;
		if (!searchData) {
			this.findModel.reset();
			this.publish(items);
			return;
		}

		// The files that no editor has loaded are read from disk, once
		for (const item of this.snapshots.keys()) {
			if (!items.includes(item)) {
				this.snapshots.delete(item);
			}
		}
		const limiter = new Limiter<void>(READ_CONCURRENCY);
		try {
			await Promise.all(items
				.filter(item => !this.modelService.getModel(item.resource) && !this.snapshots.has(item))
				.map(item => limiter.queue(async () => {
					if (cts.token.isCancellationRequested) {
						return;
					}
					try {
						const content = await this.textFileService.read(item.resource, { acceptTextOnly: true });
						this.snapshots.set(item, splitLines(content.value));
					} catch {
						this.snapshots.set(item, []);
					}
				})));
		} finally {
			limiter.dispose();
		}
		if (cts.token.isCancellationRequested) {
			return;
		}

		const matches: IMultibufferFindMatch[] = [];
		items.forEach((item, fileIndex) => {
			const model = this.modelService.getModel(item.resource);
			const snapshot = this.snapshots.get(item);
			const getLine = model
				? (lineNumber: number) => lineNumber <= model.getLineCount() ? model.getLineContent(lineNumber) : undefined
				: (lineNumber: number) => snapshot?.[lineNumber - 1];
			for (const range of findInExcerpts(getLine, item.getShownExcerpts(this.widget.matchLinesOnly.get()), searchData, MULTIBUFFER_FIND_LIMIT - matches.length)) {
				matches.push({ fileIndex, range });
			}
		});
		this.findModel.setMatches(matches);
		if (this.revealOnUpdate) {
			this.revealOnUpdate = false;
			this.reveal(this.findModel.next(this.widget.getActivePosition()));
		} else {
			this.publish(items);
		}
	}

	private reveal(match: IMultibufferFindMatch | undefined): void {
		const items = this.widget.items.get();
		this.publish(items);
		const item = match ? items[match.fileIndex] : undefined;
		if (match && item) {
			this.widget.revealRange(item, match.range);
		}
	}

	private publish(items: readonly MultibufferFileItem[]): void {
		const matches = new Map<MultibufferFileItem, Range[]>();
		for (const match of this.findModel.matches) {
			const item = items[match.fileIndex];
			if (item) {
				const ranges = matches.get(item) ?? [];
				ranges.push(match.range);
				matches.set(item, ranges);
			}
		}
		const current = this.findModel.current;
		const currentItem = current ? items[current.fileIndex] : undefined;
		this.widget.setFindDecorations(matches.size > 0 ? { matches, current: current && currentItem ? { item: currentItem, range: current.range } : undefined } : undefined);
		this._onDidUpdate.fire();
	}
}

/** The find widget of a multibuffer, at the top of its files, which finds in all of them. */
export class MultibufferFindWidget extends SimpleFindWidget {

	private readonly controller: MultibufferFindController;
	private readonly findVisible: IContextKey<boolean>;
	private readonly findFocused: IContextKey<boolean>;

	constructor(
		widget: MultibufferWidget,
		private readonly onDidHide: () => void,
		@IContextViewService contextViewService: IContextViewService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IHoverService hoverService: IHoverService,
		@IKeybindingService keybindingService: IKeybindingService,
		@IConfigurationService configurationService: IConfigurationService,
		@IAccessibilityService accessibilityService: IAccessibilityService,
		@IModelService modelService: IModelService,
		@ITextFileService textFileService: ITextFileService,
	) {
		super({
			showCommonFindToggles: true,
			showResultCount: true,
			enableSash: true,
			matchesLimit: MULTIBUFFER_FIND_LIMIT,
			previousMatchActionId: MultibufferCommandId.FindPrevious,
			nextMatchActionId: MultibufferCommandId.FindNext,
			closeWidgetActionId: MultibufferCommandId.CloseFind,
		}, contextViewService, contextKeyService, hoverService, keybindingService, configurationService, accessibilityService);
		this.controller = this._register(new MultibufferFindController(widget, modelService, textFileService, configurationService));
		this.findVisible = MultibufferFindVisibleContext.bindTo(contextKeyService);
		this.findFocused = MultibufferFindFocusedContext.bindTo(contextKeyService);
		this._register(this.controller.onDidUpdate(() => void this.updateResultCount()));

		// Enter moves to the next match, Shift+Enter to the previous one
		this._register(addDisposableListener(this.getFindInputDomNode(), EventType.KEY_DOWN, e => {
			const event = new StandardKeyboardEvent(e);
			if (event.equals(KeyCode.Enter) || event.equals(KeyMod.Shift | KeyCode.Enter)) {
				event.preventDefault();
				event.stopPropagation();
				this.find(event.shiftKey);
			}
		}));
	}

	find(previous: boolean): void {
		void (previous ? this.controller.previous() : this.controller.next());
	}

	findFirst(): void {
		void this.controller.setQuery(this.readQuery());
	}

	override reveal(initialInput?: string, animated?: boolean): void {
		const wasVisible = this.isVisible();
		super.reveal(initialInput, animated);
		this.findVisible.set(true);
		if (!wasVisible || initialInput) {
			this.findFirst();
		}
	}

	override hide(animated?: boolean): void {
		const wasVisible = this.isVisible();
		super.hide(animated);
		this.findVisible.reset();
		this.controller.clear();
		if (wasVisible) {
			this.onDidHide();
		}
	}

	protected _onInputChanged(): boolean {
		this.findFirst();
		return this.controller.count > 0;
	}

	protected async _getResultCount(): Promise<{ resultIndex: number; resultCount: number } | undefined> {
		return { resultIndex: this.controller.currentIndex, resultCount: this.controller.count };
	}

	protected _onFocusTrackerFocus(): void {
		this.findFocused.set(true);
	}

	protected _onFocusTrackerBlur(): void {
		this.findFocused.reset();
	}

	protected _onFindInputFocusTrackerFocus(): void { }

	protected _onFindInputFocusTrackerBlur(): void { }

	private readQuery(): IMultibufferFindQuery {
		return {
			searchString: this.inputValue,
			isRegex: this._getRegexValue(),
			matchCase: this._getCaseSensitiveValue(),
			wholeWord: this._getWholeWordValue(),
		};
	}
}
