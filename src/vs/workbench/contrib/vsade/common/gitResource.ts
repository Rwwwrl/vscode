/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Schemas } from '../../../../base/common/network.js';
import { URI } from '../../../../base/common/uri.js';

/** A document of the git extension: the content of a file at a ref (`''` or `'~'` is the index). */
export interface IGitResource {
	/** The file in the working tree. */
	readonly file: URI;
	readonly ref: string;
	/** Set when the document is the diff of a submodule rather than the content of a file. */
	readonly submoduleOf?: string;
}

/**
 * Parses a `git:` resource of the git extension, which keeps the path of the file in the query
 * because its own path can carry a suffix.
 */
export function parseGitResource(resource: URI): IGitResource | undefined {
	if (resource.scheme !== Schemas.git) {
		return undefined;
	}

	let query: { path?: unknown; ref?: unknown; submoduleOf?: unknown };
	try {
		query = JSON.parse(resource.query);
	} catch {
		return undefined; // not a resource of the git extension
	}

	if (!query || typeof query.path !== 'string' || !query.path) {
		return undefined;
	}

	return {
		file: URI.file(query.path),
		ref: typeof query.ref === 'string' ? query.ref : '',
		...(typeof query.submoduleOf === 'string' ? { submoduleOf: query.submoduleOf } : {}),
	};
}
