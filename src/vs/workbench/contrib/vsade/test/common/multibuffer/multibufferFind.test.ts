/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { Range } from '../../../../../../editor/common/core/range.js';
import { USUAL_WORD_SEPARATORS } from '../../../../../../editor/common/core/wordHelper.js';
import { IFileMatch, ITextSearchMatch } from '../../../../../services/search/common/search.js';
import { findInExcerpts, IMultibufferFindMatch, IMultibufferFindQuery, MultibufferFindModel, parseFindQuery } from '../../../common/multibuffer/multibufferFind.js';
import { estimateLineTop } from '../../../common/multibuffer/multibufferExcerpts.js';
import { mapTextSearchResults } from '../../../common/multibuffer/multibufferSearchResults.js';

const LINES = [
	'const total = sumBy(items);',
	'// TODO(perf): cache the total',
	'logger.info(total);',
	'const subtotal = total - tax;',
	'Total: TOTAL',
];

function find(query: Partial<IMultibufferFindQuery> & { searchString: string }, excerpts = [{ startLineNumber: 1, endLineNumber: LINES.length }], limit = 100): string[] {
	const searchData = parseFindQuery({ isRegex: false, matchCase: false, wholeWord: false, ...query }, USUAL_WORD_SEPARATORS);
	return searchData ? findInExcerpts(lineNumber => LINES[lineNumber - 1], excerpts, searchData, limit).map(range => range.toString()) : ['invalid'];
}

function match(fileIndex: number, lineNumber: number, column = 1): IMultibufferFindMatch {
	return { fileIndex, range: new Range(lineNumber, column, lineNumber, column + 1) };
}

suite('Multibuffer Find', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('finds in the lines of the excerpts only, by case, whole word and regular expression', () => {
		assert.deepStrictEqual({
			plain: find({ searchString: 'total' }),
			matchCase: find({ searchString: 'total', matchCase: true }),
			wholeWord: find({ searchString: 'total', wholeWord: true, matchCase: true }),
			regex: find({ searchString: 'T[A-Z]+L', isRegex: true, matchCase: true }),
			excerpts: find({ searchString: 'total' }, [{ startLineNumber: 3, endLineNumber: 3 }, { startLineNumber: 5, endLineNumber: 9 }]),
			limit: find({ searchString: 'total' }, undefined, 2),
			empty: find({ searchString: '' }),
			invalid: find({ searchString: '(', isRegex: true }),
			zeroLength: find({ searchString: '^', isRegex: true }, [{ startLineNumber: 1, endLineNumber: 2 }]),
		}, {
			plain: ['[1,7 -> 1,12]', '[2,26 -> 2,31]', '[3,13 -> 3,18]', '[4,10 -> 4,15]', '[4,18 -> 4,23]', '[5,1 -> 5,6]', '[5,8 -> 5,13]'],
			matchCase: ['[1,7 -> 1,12]', '[2,26 -> 2,31]', '[3,13 -> 3,18]', '[4,10 -> 4,15]', '[4,18 -> 4,23]'],
			wholeWord: ['[1,7 -> 1,12]', '[2,26 -> 2,31]', '[3,13 -> 3,18]', '[4,18 -> 4,23]'],
			regex: ['[5,8 -> 5,13]'],
			excerpts: ['[3,13 -> 3,18]', '[5,1 -> 5,6]', '[5,8 -> 5,13]'],
			limit: ['[1,7 -> 1,12]', '[2,26 -> 2,31]'],
			empty: ['invalid'],
			invalid: ['invalid'],
			zeroLength: ['[1,1 -> 1,1]', '[2,1 -> 2,1]'],
		});
	});

	test('moves through the matches of all files, from the cursor, and keeps its place when they change', () => {
		const model = new MultibufferFindModel();
		model.setMatches([match(0, 3), match(0, 9), match(1, 2), match(2, 5)]);
		const fromCursor = model.next(match(0, 5));
		const next = [model.next(), model.next(), model.next()];
		model.setMatches([match(0, 3), match(0, 9), match(1, 1), match(2, 5), match(2, 8)]);
		const kept = model.current;
		const previous = model.previous();

		const fresh = new MultibufferFindModel();
		fresh.setMatches([match(0, 3), match(1, 2)]);
		const previousFromCursor = fresh.previous(match(1, 1));
		const none = new MultibufferFindModel().next();

		assert.deepStrictEqual({ fromCursor, next, kept, previous, previousFromCursor, none, count: model.matches.length, index: model.currentIndex }, {
			fromCursor: match(0, 9),
			next: [match(1, 2), match(2, 5), match(0, 3)],
			kept: match(0, 3),
			previous: match(2, 8),
			previousFromCursor: match(0, 3),
			none: undefined,
			count: 5,
			index: 4,
		});
	});

	test('maps text search results to the matches of each file, counting from 1, once per file', () => {
		const a = URI.file('/workspace/a.ts');
		const b = URI.file('/workspace/b.ts');
		const result = (line: number, start: number, end: number): ITextSearchMatch => ({
			previewText: 'preview',
			rangeLocations: [{ source: { startLineNumber: line, startColumn: start, endLineNumber: line, endColumn: end }, preview: { startLineNumber: 0, startColumn: start, endLineNumber: 0, endColumn: end } }],
		});
		const fileMatches: IFileMatch[] = [
			{ resource: b, results: [result(9, 4, 8), { text: 'context', lineNumber: 9 }, result(0, 0, 2), result(0, 0, 2)] },
			{ resource: URI.file('/workspace/empty.ts'), results: [] },
			{ resource: a, results: [result(4, 1, 3)] },
			// The same file again, such as from a second workspace folder that holds it
			{ resource: b, results: [result(9, 4, 8), result(12, 0, 1)] },
		];
		assert.deepStrictEqual(mapTextSearchResults(fileMatches).map(file => ({ resource: file.resource.path, matches: file.matches.map(range => Range.lift(range).toString()) })), [
			{ resource: '/workspace/a.ts', matches: ['[5,2 -> 5,4]'] },
			{ resource: '/workspace/b.ts', matches: ['[1,1 -> 1,3]', '[10,5 -> 10,9]', '[13,1 -> 13,2]'] },
		]);
	});

	test('estimates the top of a line of a file that is not shown yet', () => {
		const excerpts = [{ startLineNumber: 10, endLineNumber: 12 }, { startLineNumber: 20, endLineNumber: 22 }];
		assert.deepStrictEqual(
			[estimateLineTop(excerpts, 10, 10, 5), estimateLineTop(excerpts, 12, 10, 5), estimateLineTop(excerpts, 21, 10, 5), estimateLineTop([{ startLineNumber: 1, endLineNumber: 3 }], 2, 10, 5)],
			[5, 25, 5 + 30 + 5 + 10, 10],
		);
	});
});
