/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { Position } from '../../../../../../editor/common/core/position.js';
import { linesDiffComputers } from '../../../../../../editor/common/diff/linesDiffComputers.js';
import { createTextModel } from '../../../../../../editor/test/common/testTextModel.js';
import { mapSnapshotPosition } from '../../../browser/gitSnapshotLanguageFeatures/gitSnapshotPositionMapper.js';

suite('Git Snapshot Language Features - position mapper', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	const snapshot = [
		'def hello_world(value: int):',
		'    return value',
		'',
		'c = hello_world(value=10)',
		'print(c)',
	];

	/** Maps a position of {@link snapshot} to the file on disk with the given lines. */
	function map(fileLines: string[], position: Position): string | undefined {
		const snapshotModel = store.add(createTextModel(snapshot.join('\n')));
		const fileModel = store.add(createTextModel(fileLines.join('\n')));
		const { changes } = linesDiffComputers.getDefault().computeDiff(snapshot, fileLines, { ignoreTrimWhitespace: false, maxComputationTimeMs: 0, computeMoves: false });
		return mapSnapshotPosition(snapshotModel, fileModel, position, changes)?.toString();
	}

	test('maps a symbol to the same symbol on disk', () => {
		const call = new Position(4, 8); // inside `hello_world` of the call

		assert.deepStrictEqual({
			identical: map(snapshot, call),
			linesInsertedAbove: map(['import os', '', ...snapshot], call),
			lineDeletedAbove: map([snapshot[0], snapshot[1], snapshot[3], snapshot[4]], call),
			lineEditedAbove: map([snapshot[0], '    return value * 2', snapshot[2], snapshot[3], snapshot[4]], call),
			lineEditedAround: map([snapshot[0], snapshot[1], snapshot[2], 'result = hello_world(value=20)', snapshot[4]], call),
			symbolRemoved: map([snapshot[0], snapshot[1], snapshot[2], 'c = goodbye(value=10)', snapshot[4]], call),
			lineRemoved: map([snapshot[0], snapshot[1], snapshot[2], snapshot[4]], call),
		}, {
			identical: '(4,8)',
			linesInsertedAbove: '(6,8)',
			lineDeletedAbove: '(3,8)',
			lineEditedAbove: '(4,8)',
			lineEditedAround: '(4,13)',
			symbolRemoved: undefined,
			lineRemoved: undefined,
		});
	});
});
