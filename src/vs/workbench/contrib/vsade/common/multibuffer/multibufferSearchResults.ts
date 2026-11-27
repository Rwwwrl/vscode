/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { ResourceMap } from '../../../../../base/common/map.js';
import { extUri } from '../../../../../base/common/resources.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { IFileMatch, resultIsMatch } from '../../../../services/search/common/search.js';
import { IMultibufferFileMatches } from './multibuffer.js';

/**
 * The matches of a text search by file: files in the order of their paths, and the matches of each in their order in
 * the file, without duplicates. A file can come more than once, such as from two workspace folders that both hold it.
 * Search ranges count lines and columns from 0, editor ranges from 1.
 */
export function mapTextSearchResults(fileMatches: readonly IFileMatch[]): IMultibufferFileMatches[] {
	const rangesByFile = new ResourceMap<Range[]>();
	for (const fileMatch of fileMatches) {
		const ranges = rangesByFile.get(fileMatch.resource) ?? [];
		rangesByFile.set(fileMatch.resource, ranges);
		for (const result of fileMatch.results ?? []) {
			if (!resultIsMatch(result)) {
				continue;
			}
			for (const location of result.rangeLocations) {
				const source = location.source;
				ranges.push(new Range(source.startLineNumber + 1, source.startColumn + 1, source.endLineNumber + 1, source.endColumn + 1));
			}
		}
	}
	const files: IMultibufferFileMatches[] = [];
	for (const [resource, ranges] of rangesByFile) {
		ranges.sort(Range.compareRangesUsingStarts);
		const matches = ranges.filter((range, index) => index === 0 || !range.equalsRange(ranges[index - 1]));
		if (matches.length > 0) {
			files.push({ resource, matches });
		}
	}
	return files.sort((a, b) => extUri.compare(a.resource, b.resource));
}
