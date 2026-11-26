/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { IRange } from '../../../../../editor/common/core/range.js';

/** The lines of a file that a multibuffer shows, from `startLineNumber` to `endLineNumber`, both included. */
export interface IMultibufferExcerpt {
	readonly startLineNumber: number;
	readonly endLineNumber: number;
}

/**
 * Lines of a file that a multibuffer hides, from `startLineNumber` to `endLineNumber`, both included, with the excerpts
 * around them by their index: `above` is undefined for the lines before the first excerpt, `below` for those after the
 * last one.
 */
export interface IMultibufferExcerptGap {
	readonly startLineNumber: number;
	readonly endLineNumber: number;
	readonly above: number | undefined;
	readonly below: number | undefined;
}

/**
 * The excerpts that show `matches` with `contextLines` lines above and below each: sorted, and merged where they overlap
 * or touch. `lineCount` is the number of lines of the file when it is known, and limits the excerpts to it.
 */
export function computeExcerpts(matches: readonly IRange[], contextLines: number, lineCount: number | undefined): IMultibufferExcerpt[] {
	const context = Math.max(0, Math.floor(contextLines));
	return mergeExcerpts(matches.map(match => clampExcerpt({
		startLineNumber: match.startLineNumber - context,
		endLineNumber: Math.max(match.startLineNumber, match.endLineNumber) + context,
	}, lineCount)));
}

/** `excerpts` limited to a file of `lineCount` lines, such as after it got shorter: an excerpt past its end shows its last line. */
export function clampExcerpts(excerpts: readonly IMultibufferExcerpt[], lineCount: number): IMultibufferExcerpt[] {
	return mergeExcerpts(excerpts.map(excerpt => clampExcerpt(excerpt, lineCount)));
}

/**
 * `excerpts` with the excerpt at `index` grown by `lines` lines, `up` towards the start of the file or `down` towards its
 * end, and merged with its neighbour when they meet.
 */
export function expandExcerpt(excerpts: readonly IMultibufferExcerpt[], index: number, direction: 'up' | 'down', lines: number, lineCount: number): IMultibufferExcerpt[] {
	const excerpt = excerpts[index];
	if (!excerpt) {
		return [...excerpts];
	}
	const amount = Math.max(0, Math.floor(lines));
	const expanded = direction === 'up'
		? { startLineNumber: excerpt.startLineNumber - amount, endLineNumber: excerpt.endLineNumber }
		: { startLineNumber: excerpt.startLineNumber, endLineNumber: excerpt.endLineNumber + amount };
	return clampExcerpts(excerpts.map((candidate, candidateIndex) => candidateIndex === index ? expanded : candidate), lineCount);
}

/** The lines of a file of `lineCount` lines that `excerpts` do not show, in the order of the file. */
export function computeExcerptGaps(excerpts: readonly IMultibufferExcerpt[], lineCount: number): IMultibufferExcerptGap[] {
	const gaps: IMultibufferExcerptGap[] = [];
	let nextVisibleLineNumber = 1;
	for (let index = 0; index < excerpts.length; index++) {
		const excerpt = excerpts[index];
		if (excerpt.startLineNumber > nextVisibleLineNumber) {
			gaps.push({
				startLineNumber: nextVisibleLineNumber,
				endLineNumber: excerpt.startLineNumber - 1,
				above: index === 0 ? undefined : index - 1,
				below: index,
			});
		}
		nextVisibleLineNumber = Math.max(nextVisibleLineNumber, excerpt.endLineNumber + 1);
	}
	if (excerpts.length > 0 && nextVisibleLineNumber <= lineCount) {
		gaps.push({
			startLineNumber: nextVisibleLineNumber,
			endLineNumber: lineCount,
			above: excerpts.length - 1,
			below: undefined,
		});
	}
	return gaps;
}

/** The index of the excerpt that shows `lineNumber`, or of the excerpt nearest to it when none does. */
export function findExcerptIndex(excerpts: readonly IMultibufferExcerpt[], lineNumber: number): number | undefined {
	let nearest: number | undefined;
	let nearestDistance = Number.POSITIVE_INFINITY;
	for (let index = 0; index < excerpts.length; index++) {
		const excerpt = excerpts[index];
		const distance = lineNumber < excerpt.startLineNumber
			? excerpt.startLineNumber - lineNumber
			: lineNumber > excerpt.endLineNumber ? lineNumber - excerpt.endLineNumber : 0;
		if (distance < nearestDistance) {
			nearest = index;
			nearestDistance = distance;
		}
	}
	return nearest;
}

/**
 * The height of the editor of a file that shows `excerpts`, with lines of `lineHeight` and separators of `separatorHeight`
 * in place of the hidden lines. Without `lineCount`, the file is taken to go on after the last excerpt.
 */
export function estimateExcerptsHeight(excerpts: readonly IMultibufferExcerpt[], lineCount: number | undefined, lineHeight: number, separatorHeight: number): number {
	if (excerpts.length === 0) {
		return 0;
	}
	const lines = excerpts.reduce((sum, excerpt) => sum + excerpt.endLineNumber - excerpt.startLineNumber + 1, 0);
	const separators = lineCount === undefined
		? (excerpts[0].startLineNumber > 1 ? 1 : 0) + excerpts.length
		: computeExcerptGaps(excerpts, lineCount).length;
	return lines * lineHeight + separators * separatorHeight;
}

/**
 * The top of `lineNumber` in the editor of a file that shows `excerpts`, as {@link estimateExcerptsHeight} estimates
 * heights: for a line of a file whose editor did not measure it yet.
 */
export function estimateLineTop(excerpts: readonly IMultibufferExcerpt[], lineNumber: number, lineHeight: number, separatorHeight: number): number {
	let top = 0;
	for (const excerpt of excerpts) {
		if (excerpt.startLineNumber > 1 || top > 0) {
			top += separatorHeight;
		}
		if (lineNumber <= excerpt.endLineNumber) {
			return top + Math.max(0, lineNumber - excerpt.startLineNumber) * lineHeight;
		}
		top += (excerpt.endLineNumber - excerpt.startLineNumber + 1) * lineHeight;
	}
	return top;
}

/** Whether `a` and `b` show the same lines. */
export function excerptsEqual(a: readonly IMultibufferExcerpt[], b: readonly IMultibufferExcerpt[]): boolean {
	return a.length === b.length && a.every((excerpt, index) => excerpt.startLineNumber === b[index].startLineNumber && excerpt.endLineNumber === b[index].endLineNumber);
}

function clampExcerpt(excerpt: IMultibufferExcerpt, lineCount: number | undefined): IMultibufferExcerpt {
	const lastLineNumber = lineCount === undefined ? Number.MAX_SAFE_INTEGER : Math.max(1, lineCount);
	const startLineNumber = Math.min(Math.max(1, excerpt.startLineNumber), lastLineNumber);
	const endLineNumber = Math.min(Math.max(startLineNumber, excerpt.endLineNumber), lastLineNumber);
	return { startLineNumber, endLineNumber };
}

function mergeExcerpts(excerpts: readonly IMultibufferExcerpt[]): IMultibufferExcerpt[] {
	const sorted = [...excerpts].sort((a, b) => a.startLineNumber - b.startLineNumber || a.endLineNumber - b.endLineNumber);
	const merged: IMultibufferExcerpt[] = [];
	for (const excerpt of sorted) {
		const last = merged.at(-1);
		if (last && excerpt.startLineNumber <= last.endLineNumber + 1) {
			merged[merged.length - 1] = { startLineNumber: last.startLineNumber, endLineNumber: Math.max(last.endLineNumber, excerpt.endLineNumber) };
		} else {
			merged.push(excerpt);
		}
	}
	return merged;
}
