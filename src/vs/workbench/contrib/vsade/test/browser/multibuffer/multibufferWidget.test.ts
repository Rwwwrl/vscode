/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { Dimension } from '../../../../../../base/browser/dom.js';
import { timeout } from '../../../../../../base/common/async.js';
import { toDisposable } from '../../../../../../base/common/lifecycle.js';
import { constObservable } from '../../../../../../base/common/observable.js';
import { URI } from '../../../../../../base/common/uri.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { Range } from '../../../../../../editor/common/core/range.js';
import { ITextModel } from '../../../../../../editor/common/model.js';
import { InMemoryTextModelService } from '../../../../../../editor/common/services/inMemoryTextModelService.js';
import { IModelService } from '../../../../../../editor/common/services/model.js';
import { ITextModelService } from '../../../../../../editor/common/services/resolverService.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { IUserInteractionService, MockUserInteractionService } from '../../../../../../platform/userInteraction/browser/userInteractionService.js';
import { workbenchInstantiationService } from '../../../../../test/browser/workbenchTestServices.js';
import { MultibufferFileItem, MultibufferModel } from '../../../browser/multibuffer/multibufferModel.js';
import { MultibufferWidget } from '../../../browser/multibuffer/multibufferWidget.js';

function lines(count: number): string {
	return Array.from({ length: count }, (_, index) => `line ${index + 1}`).join('\n');
}

function match(lineNumber: number): Range {
	return new Range(lineNumber, 1, lineNumber, 5);
}

suite('Multibuffer Widget', () => {

	const disposables = ensureNoDisposablesAreLeakedInTestSuite();

	let instantiationService: TestInstantiationService;
	let a: ITextModel;
	let b: ITextModel;

	setup(() => {
		instantiationService = workbenchInstantiationService(undefined, disposables);
		instantiationService.stub(IUserInteractionService, new MockUserInteractionService(false));
		instantiationService.stub(ITextModelService, instantiationService.createInstance(InMemoryTextModelService));
		const modelService = instantiationService.get(IModelService);
		a = disposables.add(modelService.createModel(lines(100), null, URI.file('/workspace/a.ts')));
		b = disposables.add(modelService.createModel(lines(10), null, URI.file('/workspace/b.ts')));
	});

	async function createWidget(): Promise<{ widget: MultibufferWidget; items: readonly MultibufferFileItem[] }> {
		const container = document.createElement('div');
		document.body.appendChild(container);
		disposables.add(toDisposable(() => container.remove()));
		const model = disposables.add(new MultibufferModel('test', [
			{ resource: a.uri, matches: [match(50)] },
			{ resource: b.uri, matches: [match(2)] },
		], 2));
		const widget = disposables.add(instantiationService.createInstance(MultibufferWidget, container, constObservable(new Dimension(800, 2000)), constObservable(model), constObservable(20)));
		// The files on screen load their models after the widget renders them
		await timeout(10);
		return { widget, items: model.items.get() };
	}

	function describe(widget: MultibufferWidget, item: MultibufferFileItem) {
		widget.setActive(item);
		const editor = widget.activeBinding.get()?.editor;
		return {
			excerpts: item.excerpts.get().map(excerpt => [excerpt.startLineNumber, excerpt.endLineNumber]),
			hidden: editor?._getViewModel()?.getHiddenAreas().map(range => [range.startLineNumber, range.endLineNumber]),
		};
	}

	test('shows the excerpts of each file and hides the lines around them', async () => {
		const { widget, items } = await createWidget();
		assert.deepStrictEqual(items.map(item => describe(widget, item)), [
			{ excerpts: [[48, 52]], hidden: [[1, 47], [53, 100]] },
			{ excerpts: [[1, 4]], hidden: [[5, 10]] },
		]);
	});

	test('keeps the excerpts on their lines as the file changes, and expands them', async () => {
		const { widget, items } = await createWidget();
		a.applyEdits([{ range: new Range(1, 1, 1, 1), text: 'new\nnew\nnew\n' }]);
		const edited = describe(widget, items[0]);
		widget.setActive(items[0]);
		const binding = widget.activeBinding.get();
		binding?.editor.setPosition({ lineNumber: 53, column: 1 });
		binding?.expandAtCursor('down');
		assert.deepStrictEqual({ edited, expanded: describe(widget, items[0]) }, {
			edited: { excerpts: [[51, 55]], hidden: [[1, 50], [56, 103]] },
			expanded: { excerpts: [[51, 75]], hidden: [[1, 50], [76, 103]] },
		});
	});

	test('leaves no decorations on the models once it is disposed', async () => {
		const { widget } = await createWidget();
		const decorated = [a.getAllDecorations().length > 0, b.getAllDecorations().length > 0];
		widget.dispose();
		assert.deepStrictEqual({ decorated, after: [a.getAllDecorations().length, b.getAllDecorations().length] }, {
			decorated: [true, true],
			after: [0, 0],
		});
	});
});
