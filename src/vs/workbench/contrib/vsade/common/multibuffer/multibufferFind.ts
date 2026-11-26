/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Range } from '../../../../../editor/common/core/range.js';
import { SearchData } from '../../../../../editor/common/model.js';
import { Searcher, SearchParams } from '../../../../../editor/common/model/textModelSearch.js';
import { IMultibufferExcerpt } from './multibufferExcerpts.js';

/** What the find of a multibuffer looks for in its excerpts. */
export interface IMultibufferFindQuery {
	readonly searchString: string;
	readonly isRegex: boolean;
	readonly matchCase: boolean;
	readonly wholeWord: boolean;
}

/** A match of the find of a multibuffer: in the file at `fileIndex` of the multibuffer. */
export interface IMultibufferFindMatch {
	readonly fileIndex: number;
	readonly range: Range;
}

/** The most matches the find of a multibuffer counts, as the find of an editor does. */
export const MULTIBUFFER_FIND_LIMIT = 19999;

/** The search that `query` asks for, or undefined when it asks for nothing or is not a valid regular expression. */
export function parseFindQuery(query: IMultibufferFindQuery, wordSeparators: string): SearchData | undefined {
	return new SearchParams(query.searchString, query.isRegex, query.matchCase, query.wholeWord ? wordSeparators : null).parseSearchRequest() ?? undefined;
}

/**
 * The matches of `searchData` on the lines of `excerpts`, at most `limit`. A match does not span lines: the find of a
 * multibuffer looks at the lines of an excerpt one by one. `getLine` gives the text of a line, or undefined past the end
 * of the file.
 */
export function findInExcerpts(getLine: (lineNumber: number) => string | undefined, excerpts: readonly IMultibufferExcerpt[], searchData: SearchData, limit: number): Range[] {
	const ranges: Range[] = [];
	const searcher = new Searcher(searchData.wordSeparators, searchData.regex);
	for (const excerpt of excerpts) {
		for (let lineNumber = excerpt.startLineNumber; lineNumber <= excerpt.endLineNumber; lineNumber++) {
			const text = getLine(lineNumber);
			if (text === undefined) {
				break;
			}
			searcher.reset(0);
			let match: RegExpExecArray | null;
			while ((match = searcher.next(text))) {
				if (ranges.length >= limit) {
					return ranges;
				}
				ranges.push(new Range(lineNumber, match.index + 1, lineNumber, match.index + match[0].length + 1));
			}
		}
	}
	return ranges;
}

/**
 * The matches of the find of a multibuffer across its files, and the one it is at. It stays at the same match, or the
 * next one after it, when the matches change, such as when a file loads or changes.
 */
export class MultibufferFindModel {

	private _matches: readonly IMultibufferFindMatch[] = [];
	private _currentIndex = -1;

	get matches(): readonly IMultibufferFindMatch[] {
		return this._matches;
	}

	/** The index of the current match, or -1 before the find moved to one. */
	get currentIndex(): number {
		return this._currentIndex;
	}

	get current(): IMultibufferFindMatch | undefined {
		return this._matches[this._currentIndex];
	}

	setMatches(matches: readonly IMultibufferFindMatch[]): void {
		const current = this.current;
		this._matches = matches;
		this._currentIndex = current ? this.indexAtOrAfter(current) : -1;
	}

	/** Moves to the next match, after the current one or after `from` without one, wrapping around. */
	next(from?: IMultibufferFindMatch): IMultibufferFindMatch | undefined {
		if (this._matches.length === 0) {
			return undefined;
		}
		if (this._currentIndex === -1) {
			this._currentIndex = from ? this.indexAtOrAfter(from) : 0;
		} else {
			this._currentIndex = (this._currentIndex + 1) % this._matches.length;
		}
		return this.current;
	}

	/** Moves to the previous match, before the current one or before `from` without one, wrapping around. */
	previous(from?: IMultibufferFindMatch): IMultibufferFindMatch | undefined {
		const count = this._matches.length;
		if (count === 0) {
			return undefined;
		}
		if (this._currentIndex === -1) {
			this._currentIndex = from ? (this.indexAtOrAfter(from) - 1 + count) % count : count - 1;
		} else {
			this._currentIndex = (this._currentIndex - 1 + count) % count;
		}
		return this.current;
	}

	reset(): void {
		this._matches = [];
		this._currentIndex = -1;
	}

	private indexAtOrAfter(position: IMultibufferFindMatch): number {
		if (this._matches.length === 0) {
			return -1;
		}
		const index = this._matches.findIndex(match => compareMatches(match, position) >= 0);
		return index === -1 ? 0 : index;
	}
}

function compareMatches(a: IMultibufferFindMatch, b: IMultibufferFindMatch): number {
	return a.fileIndex - b.fileIndex || Range.compareRangesUsingStarts(a.range, b.range);
}
