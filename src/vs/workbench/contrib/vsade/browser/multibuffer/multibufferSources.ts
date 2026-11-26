/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { LocationLink } from '../../../../../editor/common/languages.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { getReferencesAtPosition } from '../../../../../editor/contrib/gotoSymbol/browser/goToSymbol.js';
import { ReferencesModel } from '../../../../../editor/contrib/gotoSymbol/browser/referencesModel.js';
import { IMultibufferFileMatches } from '../../common/multibuffer/multibuffer.js';

/**
 * `locations` by file, as the references view shows them: files in the order of their paths, and the locations in each
 * file in their order, without duplicates.
 */
export function groupLocationsByFile(locations: readonly LocationLink[]): IMultibufferFileMatches[] {
	// The references model sorts what it gets in place
	const references = new ReferencesModel([...locations], '');
	try {
		return references.groups.map(group => ({
			resource: group.uri,
			matches: group.children.map(reference => reference.range),
		}));
	} finally {
		references.dispose();
	}
}

/** The references to the symbol at `position` of `model`, the declaration among them, by file. */
export async function findReferencesByFile(languageFeaturesService: ILanguageFeaturesService, model: ITextModel, position: Position, token: CancellationToken): Promise<IMultibufferFileMatches[]> {
	const locations = await getReferencesAtPosition(languageFeaturesService.referenceProvider, model, position, false, false, token);
	return groupLocationsByFile(locations);
}
