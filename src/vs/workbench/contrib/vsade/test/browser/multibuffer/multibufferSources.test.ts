/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { Range } from '../../../../../../editor/common/core/range.js';
import { LocationLink } from '../../../../../../editor/common/languages.js';
import { groupLocationsByFile } from '../../../browser/multibuffer/multibufferSources.js';

suite('Multibuffer Sources', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	test('groups references by file, in the order of their paths and lines, without duplicates', () => {
		const a = URI.file('/workspace/a.ts');
		const b = URI.file('/workspace/b.ts');
		const locations: LocationLink[] = [
			{ uri: b, range: new Range(7, 1, 7, 4) },
			{ uri: a, range: new Range(20, 5, 20, 8) },
			{ uri: a, range: new Range(3, 1, 3, 4) },
			{ uri: b, range: new Range(7, 1, 7, 4) },
			{ uri: a, range: new Range(9, 1, 9, 4), targetSelectionRange: new Range(9, 2, 9, 3) },
		];
		const files = groupLocationsByFile(locations);
		assert.deepStrictEqual({
			files: files.map(file => ({ resource: file.resource.toString(), matches: file.matches.map(range => Range.lift(range).toString()) })),
			// The locations it got stay in their order
			locations: locations.map(location => location.uri.toString()),
		}, {
			files: [
				{ resource: a.toString(), matches: ['[3,1 -> 3,4]', '[9,2 -> 9,3]', '[20,5 -> 20,8]'] },
				{ resource: b.toString(), matches: ['[7,1 -> 7,4]'] },
			],
			locations: [b, a, a, b, a].map(uri => uri.toString()),
		});
	});
});
