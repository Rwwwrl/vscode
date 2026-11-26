/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { URI } from '../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../base/test/common/utils.js';
import { parseGitResource } from '../../common/gitResource.js';

suite('Git resource', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	const file = URI.file('/repo/src/app.py');

	function gitUri(query: string, path = file.path): URI {
		return file.with({ scheme: 'git', path, query });
	}

	function parse(resource: URI) {
		const result = parseGitResource(resource);
		return result && { ...result, file: result.file.toString() };
	}

	test('parses the documents of the git extension', () => {
		assert.deepStrictEqual({
			index: parse(gitUri(JSON.stringify({ path: file.fsPath, ref: '' }))),
			head: parse(gitUri(JSON.stringify({ path: file.fsPath, ref: 'HEAD' }))),
			suffixedPath: parse(gitUri(JSON.stringify({ path: file.fsPath, ref: '~' }), `${file.path}.git`)),
			submodule: parse(gitUri(JSON.stringify({ path: '/repo/lib', ref: 'index', submoduleOf: '/repo' }), '/repo/lib.diff')),
			noRef: parse(gitUri(JSON.stringify({ path: file.fsPath }))),
			file: parse(file),
			malformedQuery: parse(gitUri('not json')),
			noPath: parse(gitUri(JSON.stringify({ ref: 'HEAD' }))),
		}, {
			index: { file: file.toString(), ref: '' },
			head: { file: file.toString(), ref: 'HEAD' },
			suffixedPath: { file: file.toString(), ref: '~' },
			submodule: { file: URI.file('/repo/lib').toString(), ref: 'index', submoduleOf: '/repo' },
			noRef: { file: file.toString(), ref: '' },
			file: undefined,
			malformedQuery: undefined,
			noPath: undefined,
		});
	});
});
