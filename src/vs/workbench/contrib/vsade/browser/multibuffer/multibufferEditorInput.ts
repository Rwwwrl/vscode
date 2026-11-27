/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { runOnChange } from '../../../../../base/common/observable.js';
import { ThemeIcon } from '../../../../../base/common/themables.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { EditorInputCapabilities, IUntypedEditorInput } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { MULTIBUFFER_EDITOR_ID, MULTIBUFFER_INPUT_TYPE_ID, MULTIBUFFER_SCHEME } from '../../common/multibuffer/multibuffer.js';
import { MultibufferModel } from './multibufferModel.js';
import { MultibufferTextSearch } from './multibufferTextSearch.js';

/** Where a multibuffer was scrolled to when its editor last showed it, for when it shows it again. */
export interface IMultibufferViewState {
	readonly scrollTop: number;
	readonly scrollLeft: number;
}

/**
 * The input of a multibuffer. It holds all of its state, since the editor that shows it is shared by all multibuffers
 * of its group and can show it in another group later. It has no serializer: a multibuffer is gone after a reload.
 */
export class MultibufferEditorInput extends EditorInput {

	static readonly ID = MULTIBUFFER_INPUT_TYPE_ID;

	private static counter = 0;

	readonly resource = URI.from({ scheme: MULTIBUFFER_SCHEME, path: `/${MultibufferEditorInput.counter++}` });

	viewState: IMultibufferViewState | undefined;

	/**
	 * @param model The files the multibuffer shows, which it owns from then on.
	 * @param search The search of a text search multibuffer, which fills `model`; it owns it from then on too.
	 */
	constructor(
		readonly model: MultibufferModel,
		readonly search: MultibufferTextSearch | undefined,
	) {
		super();
		this._register(model);
		if (search) {
			this._register(search);
		}
		this._register(runOnChange(model.title, () => this._onDidChangeLabel.fire()));
		this._register(runOnChange(model.matchCount, () => this._onDidChangeLabel.fire()));
	}

	override get typeId(): string {
		return MultibufferEditorInput.ID;
	}

	override get editorId(): string {
		return MULTIBUFFER_EDITOR_ID;
	}

	override get capabilities(): EditorInputCapabilities {
		return EditorInputCapabilities.Readonly | EditorInputCapabilities.Singleton;
	}

	override getName(): string {
		return this.model.title.get();
	}

	override getTitle(): string {
		const matches = this.model.matchCount.get();
		const files = this.model.items.get().length;
		return localize('multibuffer.title', "{0} ({1} matches in {2} files)", this.model.title.get(), matches, files);
	}

	override getIcon(): ThemeIcon {
		return this.search ? Codicon.search : Codicon.references;
	}

	override canReopen(): boolean {
		return false;
	}

	override matches(otherInput: EditorInput | IUntypedEditorInput): boolean {
		return otherInput === this;
	}
}
