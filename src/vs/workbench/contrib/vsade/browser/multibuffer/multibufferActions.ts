/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { DisposableStore, IDisposable } from '../../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { EditorAction2, MultiEditorAction } from '../../../../../editor/browser/editorExtensions.js';
import { EditorContextKeys } from '../../../../../editor/common/editorContextKeys.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { CodeEditorStateFlag, EditorStateCancellationTokenSource } from '../../../../../editor/contrib/editorState/browser/editorState.js';
import { NextMatchFindAction, PreviousMatchFindAction, StartFindAction, StartFindReplaceAction } from '../../../../../editor/contrib/find/browser/findController.js';
import { MessageController } from '../../../../../editor/contrib/message/browser/messageController.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Action2, MenuId } from '../../../../../platform/actions/common/actions.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { TextEditorSelectionRevealType } from '../../../../../platform/editor/common/editor.js';
import { IInstantiationService, ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { WorkbenchStateContext } from '../../../../common/contextkeys.js';
import { ACTIVE_GROUP, IEditorService, SIDE_GROUP } from '../../../../services/editor/common/editorService.js';
import { IMultibufferOpenFileContext, IMultibufferTextQuery, isMultibufferOpenFileContext, MultibufferCommandId, MultibufferContext, MultibufferFileToolbarMenu, MultibufferFindVisibleContext, MultibufferHeaderToolbarMenu, MultibufferMatchLinesOnlyContext, MultibufferSettingId } from '../../common/multibuffer/multibuffer.js';
import { MultibufferEditor } from './multibufferEditor.js';
import { MultibufferEditorInput } from './multibufferEditorInput.js';
import { MultibufferModel } from './multibufferModel.js';
import { findReferencesByFile } from './multibufferSources.js';
import { getTextSearchTitle, MultibufferTextSearch } from './multibufferTextSearch.js';

const MULTIBUFFER_CATEGORY = localize2('multibuffer.category', "Multibuffer");

/** Opens the references to the symbol at the cursor in a new multibuffer, next to the editor of the symbol. */
export class FindReferencesInMultibufferAction extends EditorAction2 {
	constructor() {
		super({
			id: MultibufferCommandId.FindReferences,
			title: localize2('multibuffer.findReferences', "Find All References in Multibuffer"),
			category: MULTIBUFFER_CATEGORY,
			precondition: EditorContextKeys.hasReferenceProvider,
			f1: true,
			menu: {
				id: MenuId.EditorContext,
				when: EditorContextKeys.hasReferenceProvider,
				group: 'navigation',
				order: 1.46,
			},
		});
	}

	async runEditorCommand(accessor: ServicesAccessor, editor: ICodeEditor): Promise<void> {
		if (!editor.hasModel()) {
			return;
		}
		const languageFeaturesService = accessor.get(ILanguageFeaturesService);
		const editorService = accessor.get(IEditorService);
		const configurationService = accessor.get(IConfigurationService);

		const model = editor.getModel();
		const position = editor.getPosition();
		const word = model.getWordAtPosition(position)?.word;
		// A reference search for a symbol that the cursor left, or that was edited since, is of no use
		const cts = new EditorStateCancellationTokenSource(editor, CodeEditorStateFlag.Value | CodeEditorStateFlag.Position);
		try {
			const files = await findReferencesByFile(languageFeaturesService, model, position, cts.token);
			if (cts.token.isCancellationRequested) {
				return;
			}
			if (files.length === 0) {
				MessageController.get(editor)?.showMessage(word
					? localize('multibuffer.noReferencesTo', "No references found for '{0}'", word)
					: localize('multibuffer.noReferences', "No references found"), position);
				return;
			}
			const title = word ? localize('multibuffer.referencesTo', "References to {0}", word) : localize('multibuffer.references', "References");
			const contextLines = configurationService.getValue<number>(MultibufferSettingId.ContextLines) ?? 6;
			await editorService.openEditor(new MultibufferEditorInput(new MultibufferModel(title, files, contextLines), undefined), { pinned: true });
		} finally {
			cts.dispose();
		}
	}
}

/** Opens a new text search multibuffer, which searches the workspace for its argument, or else waits for a query. */
export class SearchInMultibufferAction extends Action2 {
	constructor() {
		super({
			id: MultibufferCommandId.Search,
			title: localize2('multibuffer.search', "Search in Multibuffer"),
			category: MULTIBUFFER_CATEGORY,
			precondition: WorkbenchStateContext.notEqualsTo('empty'),
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor, pattern?: unknown): Promise<void> {
		const editorService = accessor.get(IEditorService);
		const instantiationService = accessor.get(IInstantiationService);
		const configurationService = accessor.get(IConfigurationService);

		const query: IMultibufferTextQuery = {
			pattern: typeof pattern === 'string' ? pattern : '',
			isRegExp: false,
			isCaseSensitive: false,
			isWordMatch: false,
		};
		const model = new MultibufferModel(getTextSearchTitle(query), [], configurationService.getValue<number>(MultibufferSettingId.ContextLines) ?? 6);
		const search = instantiationService.createInstance(MultibufferTextSearch, model);
		const input = new MultibufferEditorInput(model, search);
		// The search starts before the editor opens, which then shows its query and focuses its results
		const running = query.pattern ? search.run(query) : undefined;
		await editorService.openEditor(input, { pinned: true });
		await running;
	}
}

/** The multibuffer that a command without a multibuffer of its own acts on: the active one. */
function getActiveMultibuffer(accessor: ServicesAccessor): MultibufferEditor | undefined {
	const pane = accessor.get(IEditorService).activeEditorPane;
	return pane instanceof MultibufferEditor ? pane : undefined;
}

export class FindInMultibufferAction extends Action2 {
	constructor() {
		super({
			id: MultibufferCommandId.Find,
			title: localize2('multibuffer.find', "Find in Multibuffer"),
			category: MULTIBUFFER_CATEGORY,
			precondition: MultibufferContext,
			f1: true,
			// Inside a multibuffer only; in the editor of a file, the Find command of the editor comes here too
			keybinding: {
				primary: KeyMod.CtrlCmd | KeyCode.KeyF,
				when: MultibufferContext,
				weight: KeybindingWeight.WorkbenchContrib,
			},
		});
	}

	run(accessor: ServicesAccessor): void {
		getActiveMultibuffer(accessor)?.startFind();
	}
}

export class FindNextInMultibufferAction extends Action2 {
	constructor() {
		super({
			id: MultibufferCommandId.FindNext,
			title: localize2('multibuffer.findNext', "Find Next in Multibuffer"),
			category: MULTIBUFFER_CATEGORY,
			precondition: MultibufferContext,
			f1: true,
			keybinding: {
				primary: KeyCode.F3,
				mac: { primary: KeyMod.CtrlCmd | KeyCode.KeyG, secondary: [KeyCode.F3] },
				when: ContextKeyExpr.and(MultibufferContext, MultibufferFindVisibleContext),
				weight: KeybindingWeight.WorkbenchContrib,
			},
		});
	}

	run(accessor: ServicesAccessor): void {
		getActiveMultibuffer(accessor)?.findNext();
	}
}

export class FindPreviousInMultibufferAction extends Action2 {
	constructor() {
		super({
			id: MultibufferCommandId.FindPrevious,
			title: localize2('multibuffer.findPrevious', "Find Previous in Multibuffer"),
			category: MULTIBUFFER_CATEGORY,
			precondition: MultibufferContext,
			f1: true,
			keybinding: {
				primary: KeyMod.Shift | KeyCode.F3,
				mac: { primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyG, secondary: [KeyMod.Shift | KeyCode.F3] },
				when: ContextKeyExpr.and(MultibufferContext, MultibufferFindVisibleContext),
				weight: KeybindingWeight.WorkbenchContrib,
			},
		});
	}

	run(accessor: ServicesAccessor): void {
		getActiveMultibuffer(accessor)?.findPrevious();
	}
}

export class CloseFindInMultibufferAction extends Action2 {
	constructor() {
		super({
			id: MultibufferCommandId.CloseFind,
			title: localize2('multibuffer.closeFind', "Close Find in Multibuffer"),
			category: MULTIBUFFER_CATEGORY,
			precondition: MultibufferFindVisibleContext,
			f1: true,
			keybinding: {
				primary: KeyCode.Escape,
				secondary: [KeyMod.Shift | KeyCode.Escape],
				when: ContextKeyExpr.and(MultibufferContext, MultibufferFindVisibleContext, ContextKeyExpr.not('isComposing')),
				weight: KeybindingWeight.EditorContrib + 5,
			},
		});
	}

	run(accessor: ServicesAccessor): void {
		getActiveMultibuffer(accessor)?.closeFind();
	}
}

/**
 * Takes over the find commands of an editor of a file of a multibuffer, such as when they are bound to other keys: they
 * find in all of its files instead.
 */
export function registerMultibufferFindImplementations(): IDisposable {
	const store = new DisposableStore();
	const implement = (action: MultiEditorAction, run: (multibuffer: MultibufferEditor) => void) => store.add(action.addImplementation(100, (_accessor, editor) => {
		const multibuffer = MultibufferEditor.forCodeEditor(editor);
		if (!multibuffer) {
			return false;
		}
		run(multibuffer);
		return true;
	}));
	implement(StartFindAction, multibuffer => multibuffer.startFind());
	implement(StartFindReplaceAction, multibuffer => multibuffer.startFind());
	implement(NextMatchFindAction, multibuffer => multibuffer.findNext());
	implement(PreviousMatchFindAction, multibuffer => multibuffer.findPrevious());
	return store;
}

/**
 * The file and selection that an open command acts on: those of the header it was run from, else those of the file with
 * the focus in the active multibuffer.
 */
function resolveOpenFileContext(accessor: ServicesAccessor, context: unknown): IMultibufferOpenFileContext | undefined {
	return isMultibufferOpenFileContext(context) ? context : getActiveMultibuffer(accessor)?.getActiveOpenFileContext();
}

async function openFile(accessor: ServicesAccessor, context: unknown, sideBySide: boolean): Promise<void> {
	const editorService = accessor.get(IEditorService);
	const target = resolveOpenFileContext(accessor, context);
	if (!target) {
		return;
	}
	await editorService.openEditor({
		resource: target.resource,
		options: {
			selection: target.selection,
			selectionRevealType: TextEditorSelectionRevealType.CenterIfOutsideViewport,
			pinned: true,
		},
	}, sideBySide ? SIDE_GROUP : ACTIVE_GROUP);
}

export class OpenMultibufferFileAction extends Action2 {
	constructor() {
		super({
			id: MultibufferCommandId.OpenFile,
			title: localize2('multibuffer.openFile', "Open File"),
			category: MULTIBUFFER_CATEGORY,
			icon: Codicon.goToFile,
			precondition: MultibufferContext,
			f1: true,
			menu: [{
				id: MultibufferFileToolbarMenu,
				group: 'navigation',
				order: 1,
			}, {
				id: MenuId.EditorContext,
				when: MultibufferContext,
				group: 'navigation',
				order: 0.1,
			}],
		});
	}

	run(accessor: ServicesAccessor, context?: unknown): Promise<void> {
		return openFile(accessor, context, false);
	}
}

export class OpenMultibufferFileToSideAction extends Action2 {
	constructor() {
		super({
			id: MultibufferCommandId.OpenFileToSide,
			title: localize2('multibuffer.openFileToSide', "Open File to the Side"),
			category: MULTIBUFFER_CATEGORY,
			icon: Codicon.splitHorizontal,
			precondition: MultibufferContext,
			f1: true,
			menu: [{
				id: MultibufferFileToolbarMenu,
				group: 'navigation',
				order: 2,
			}, {
				id: MenuId.EditorContext,
				when: MultibufferContext,
				group: 'navigation',
				order: 0.2,
			}],
		});
	}

	run(accessor: ServicesAccessor, context?: unknown): Promise<void> {
		return openFile(accessor, context, true);
	}
}

function expandActiveExcerpt(accessor: ServicesAccessor, direction: 'up' | 'down'): void {
	getActiveMultibuffer(accessor)?.expandActiveExcerpt(direction);
}

export class ExpandExcerptUpAction extends Action2 {
	constructor() {
		super({
			id: MultibufferCommandId.ExpandExcerptUp,
			title: localize2('multibuffer.expandExcerptUp', "Expand Excerpt Up"),
			category: MULTIBUFFER_CATEGORY,
			precondition: ContextKeyExpr.and(MultibufferContext, EditorContextKeys.focus),
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		expandActiveExcerpt(accessor, 'up');
	}
}

export class ExpandExcerptDownAction extends Action2 {
	constructor() {
		super({
			id: MultibufferCommandId.ExpandExcerptDown,
			title: localize2('multibuffer.expandExcerptDown', "Expand Excerpt Down"),
			category: MULTIBUFFER_CATEGORY,
			precondition: ContextKeyExpr.and(MultibufferContext, EditorContextKeys.focus),
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		expandActiveExcerpt(accessor, 'down');
	}
}

export class ShowMatchLinesOnlyAction extends Action2 {
	constructor() {
		super({
			id: MultibufferCommandId.ShowMatchLinesOnly,
			title: localize2('multibuffer.showMatchLinesOnly', "Show Only Matching Lines"),
			category: MULTIBUFFER_CATEGORY,
			icon: Codicon.fold,
			precondition: ContextKeyExpr.and(MultibufferContext, MultibufferMatchLinesOnlyContext.negate()),
			f1: true,
			menu: [{
				id: MultibufferHeaderToolbarMenu,
				when: MultibufferMatchLinesOnlyContext.negate(),
				group: 'navigation',
			}],
		});
	}

	run(accessor: ServicesAccessor): void {
		getActiveMultibuffer(accessor)?.setMatchLinesOnly(true);
	}
}

export class ShowExcerptsAction extends Action2 {
	constructor() {
		super({
			id: MultibufferCommandId.ShowExcerpts,
			title: localize2('multibuffer.showExcerpts', "Show Lines Around Matches"),
			category: MULTIBUFFER_CATEGORY,
			icon: Codicon.unfold,
			precondition: ContextKeyExpr.and(MultibufferContext, MultibufferMatchLinesOnlyContext),
			f1: true,
			menu: [{
				id: MultibufferHeaderToolbarMenu,
				when: MultibufferMatchLinesOnlyContext,
				group: 'navigation',
			}],
		});
	}

	run(accessor: ServicesAccessor): void {
		getActiveMultibuffer(accessor)?.setMatchLinesOnly(false);
	}
}
