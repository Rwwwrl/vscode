/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IObservable, ISettableObservable, ITransaction, observableValue } from '../../../../../base/common/observable.js';
import { URI } from '../../../../../base/common/uri.js';
import { IRange } from '../../../../../editor/common/core/range.js';
import { ISelection } from '../../../../../editor/common/core/selection.js';
import { IMultibufferFileMatches } from '../../common/multibuffer/multibuffer.js';
import { computeExcerpts, IMultibufferExcerpt } from '../../common/multibuffer/multibufferExcerpts.js';

/**
 * One file of a multibuffer: its matches and the excerpts that show them. It outlives the editor that shows it, which
 * the multibuffer only creates while the file is on screen, so it keeps what that editor would lose.
 */
export class MultibufferFileItem {
	/** The matches, where the editor of the file last saw them: they move with edits of the file while it is shown. */
	matches: readonly IRange[];

	/** The number of lines of the file when it was last shown, and undefined before. */
	lineCount: number | undefined;

	/** The selections of the editor of the file when it was last shown. */
	selections: readonly ISelection[] | undefined;

	readonly excerpts: ISettableObservable<readonly IMultibufferExcerpt[]>;
	readonly collapsed = observableValue(this, false);

	/** The height of the editor of the file when it was last shown, for its place in the scroll while it is not. */
	readonly measuredEditorHeight = observableValue<number | undefined>(this, undefined);

	constructor(
		readonly resource: URI,
		matches: readonly IRange[],
		contextLines: number,
	) {
		this.matches = matches;
		this.excerpts = observableValue(this, computeExcerpts(matches, contextLines, undefined));
	}

	/**
	 * The excerpts the editor of the file shows: its excerpts, or only the lines with matches while the multibuffer shows
	 * those alone. The excerpts are kept meanwhile, with the lines they were expanded by.
	 */
	getShownExcerpts(matchLinesOnly: boolean): readonly IMultibufferExcerpt[] {
		return matchLinesOnly ? computeExcerpts(this.matches, 0, this.lineCount) : this.excerpts.get();
	}
}

/** The files of a multibuffer, in the order it shows them. */
export class MultibufferModel extends Disposable {
	private readonly _items: ISettableObservable<readonly MultibufferFileItem[]>;
	readonly items: IObservable<readonly MultibufferFileItem[]>;

	/** The number of matches in all files. */
	readonly matchCount: IObservable<number>;

	/** Whether the files show only the lines with matches, as a list of them, instead of their excerpts. */
	readonly matchLinesOnly = observableValue(this, false);

	readonly title: ISettableObservable<string>;

	/** Set while the matches are being looked for, such as while a text search runs. */
	readonly isLoading = observableValue(this, false);

	/** Whether there were more matches than the multibuffer shows. */
	readonly limitHit = observableValue(this, false);

	/** Why the multibuffer shows no files, such as an invalid search, when it is not for want of matches. */
	readonly message = observableValue<string | undefined>(this, undefined);

	constructor(
		title: string,
		files: readonly IMultibufferFileMatches[],
		contextLines: number,
	) {
		super();
		this.title = observableValue(this, title);
		this._items = observableValue(this, createItems(files, contextLines));
		this.items = this._items;
		this.matchCount = this._items.map(items => items.reduce((sum, item) => sum + item.matches.length, 0));
	}

	/** Replaces all files at once, such as with the results of a new search. */
	setFiles(files: readonly IMultibufferFileMatches[], contextLines: number, tx: ITransaction | undefined): void {
		this._items.set(createItems(files, contextLines), tx);
	}
}

function createItems(files: readonly IMultibufferFileMatches[], contextLines: number): MultibufferFileItem[] {
	return files.map(file => new MultibufferFileItem(file.resource, file.matches, contextLines));
}
