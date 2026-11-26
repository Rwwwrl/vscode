/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { translatePosition } from '../../../../../editor/browser/widget/diffEditor/utils.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { USUAL_WORD_SEPARATORS } from '../../../../../editor/common/core/wordHelper.js';
import { DetailedLineRangeMapping } from '../../../../../editor/common/diff/rangeMapping.js';
import { ITextModel } from '../../../../../editor/common/model.js';

/**
 * Maps a position in a git snapshot of a file to the same symbol in the file on disk.
 *
 * @param changes the diff from `snapshot` (original) to `file` (modified)
 * @returns `undefined` when the symbol cannot be found on disk with confidence
 */
export function mapSnapshotPosition(snapshot: ITextModel, file: ITextModel, position: Position, changes: readonly DetailedLineRangeMapping[]): Position | undefined {
	const translated = translatePosition(position, [...changes]).getStartPosition();

	// The line is the same on disk: the common case, the line has no unstaged edits
	if (translated.lineNumber <= file.getLineCount() && snapshot.getLineContent(position.lineNumber) === file.getLineContent(translated.lineNumber)) {
		return new Position(translated.lineNumber, position.column);
	}

	// The line was edited on disk: look for the same identifier in the edited lines
	const word = snapshot.getWordAtPosition(position);
	const change = changes.find(change => change.original.contains(position.lineNumber));
	if (!word || !change || change.modified.isEmpty) {
		return undefined;
	}

	const searchRange = new Range(change.modified.startLineNumber, 1, change.modified.endLineNumberExclusive - 1, file.getLineMaxColumn(change.modified.endLineNumberExclusive - 1));
	const candidates = file.findMatches(word.word, searchRange, false, true, USUAL_WORD_SEPARATORS, false)
		.map(match => match.range.getStartPosition())
		.filter(start => file.getWordAtPosition(start)?.word === word.word);

	let closest: Position | undefined;
	let closestDistance = Number.MAX_SAFE_INTEGER;
	for (const candidate of candidates) {
		const distance = Math.abs(candidate.lineNumber - translated.lineNumber) * 10_000 + Math.abs(candidate.column - word.startColumn);
		if (distance < closestDistance) {
			closest = candidate;
			closestDistance = distance;
		}
	}

	// Keep the offset of the position inside the identifier
	return closest?.delta(0, position.column - word.startColumn);
}
