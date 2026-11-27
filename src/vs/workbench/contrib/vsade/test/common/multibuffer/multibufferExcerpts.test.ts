/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IRange } from '../../../../../../editor/common/core/range.js';
import { clampExcerpts, computeExcerptGaps, computeExcerpts, estimateExcerptsHeight, excerptsEqual, expandExcerpt, findExcerptIndex, IMultibufferExcerpt } from '../../../common/multibuffer/multibufferExcerpts.js';

function lines(lineNumber: number, endLineNumber = lineNumber): IRange {
	return { startLineNumber: lineNumber, startColumn: 1, endLineNumber, endColumn: 1 };
}

function excerpt(startLineNumber: number, endLineNumber: number): IMultibufferExcerpt {
	return { startLineNumber, endLineNumber };
}

suite('Multibuffer Excerpts', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('shows each match with its context, merging excerpts that overlap or touch', () => {
		assert.deepStrictEqual({
			apart: computeExcerpts([lines(10), lines(30)], 2, 100),
			overlapping: computeExcerpts([lines(10), lines(13)], 2, 100),
			touching: computeExcerpts([lines(10), lines(15)], 2, 100),
			unsorted: computeExcerpts([lines(30), lines(10), lines(11)], 0, 100),
			multiline: computeExcerpts([lines(10, 12)], 1, 100),
			noContext: computeExcerpts([lines(10)], 0, 100),
		}, {
			apart: [excerpt(8, 12), excerpt(28, 32)],
			overlapping: [excerpt(8, 15)],
			touching: [excerpt(8, 17)],
			unsorted: [excerpt(10, 11), excerpt(30, 30)],
			multiline: [excerpt(9, 13)],
			noContext: [excerpt(10, 10)],
		});
	});

	test('keeps excerpts inside the file, from line 1 to its last line', () => {
		assert.deepStrictEqual({
			atStart: computeExcerpts([lines(1), lines(2)], 3, 100),
			atEnd: computeExcerpts([lines(99)], 3, 100),
			lineCountUnknown: computeExcerpts([lines(99)], 3, undefined),
			shrunk: clampExcerpts([excerpt(5, 9), excerpt(40, 50), excerpt(60, 70)], 45),
		}, {
			atStart: [excerpt(1, 5)],
			atEnd: [excerpt(96, 100)],
			lineCountUnknown: [excerpt(96, 102)],
			shrunk: [excerpt(5, 9), excerpt(40, 45)],
		});
	});

	test('hides the lines between, before and after the excerpts', () => {
		assert.deepStrictEqual({
			between: computeExcerptGaps([excerpt(1, 5), excerpt(10, 12), excerpt(13, 20)], 20),
			beforeAndAfter: computeExcerptGaps([excerpt(8, 12)], 30),
			wholeFile: computeExcerptGaps([excerpt(1, 30)], 30),
			none: computeExcerptGaps([], 30),
		}, {
			between: [
				{ startLineNumber: 6, endLineNumber: 9, above: 0, below: 1 },
			],
			beforeAndAfter: [
				{ startLineNumber: 1, endLineNumber: 7, above: undefined, below: 0 },
				{ startLineNumber: 13, endLineNumber: 30, above: 0, below: undefined },
			],
			wholeFile: [],
			none: [],
		});
	});

	test('expands an excerpt up or down, merging it with the excerpt it meets', () => {
		const excerpts = [excerpt(10, 12), excerpt(20, 22)];
		assert.deepStrictEqual({
			up: expandExcerpt(excerpts, 1, 'up', 3, 30),
			down: expandExcerpt(excerpts, 0, 'down', 3, 30),
			meets: expandExcerpt(excerpts, 0, 'down', 7, 30),
			pastStart: expandExcerpt(excerpts, 0, 'up', 20, 30),
			pastEnd: expandExcerpt(excerpts, 1, 'down', 20, 30),
			missing: expandExcerpt(excerpts, 2, 'down', 3, 30),
		}, {
			up: [excerpt(10, 12), excerpt(17, 22)],
			down: [excerpt(10, 15), excerpt(20, 22)],
			meets: [excerpt(10, 22)],
			pastStart: [excerpt(1, 12), excerpt(20, 22)],
			pastEnd: [excerpt(10, 12), excerpt(20, 30)],
			missing: excerpts,
		});
	});

	test('finds the excerpt of a line, or the nearest one', () => {
		const excerpts = [excerpt(10, 12), excerpt(20, 22)];
		assert.deepStrictEqual(
			[findExcerptIndex(excerpts, 11), findExcerptIndex(excerpts, 1), findExcerptIndex(excerpts, 17), findExcerptIndex(excerpts, 99), findExcerptIndex([], 1)],
			[0, 0, 1, 1, undefined],
		);
	});

	test('estimates the height of the excerpts and their separators', () => {
		const excerpts = [excerpt(10, 12), excerpt(20, 22)];
		assert.deepStrictEqual({
			known: estimateExcerptsHeight(excerpts, 22, 10, 5),
			unknown: estimateExcerptsHeight(excerpts, undefined, 10, 5),
			fromStart: estimateExcerptsHeight([excerpt(1, 3)], 3, 10, 5),
			none: estimateExcerptsHeight([], 10, 10, 5),
			equal: [excerptsEqual(excerpts, [excerpt(10, 12), excerpt(20, 22)]), excerptsEqual(excerpts, [excerpt(10, 12)])],
		}, {
			known: 6 * 10 + 2 * 5,
			unknown: 6 * 10 + 3 * 5,
			fromStart: 3 * 10,
			none: 0,
			equal: [true, false],
		});
	});
});
