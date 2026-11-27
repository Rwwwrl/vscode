/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { EditorPaneDescriptor, IEditorPaneRegistry } from '../../../../browser/editor.js';
import { EditorExtensions } from '../../../../common/editor.js';
import { MultibufferDoubleClickBehaviour, MultibufferSettingId } from '../../common/multibuffer/multibuffer.js';
import { CloseFindInMultibufferAction, ExpandExcerptDownAction, ExpandExcerptUpAction, FindInMultibufferAction, FindNextInMultibufferAction, FindPreviousInMultibufferAction, FindReferencesInMultibufferAction, OpenMultibufferFileAction, OpenMultibufferFileToSideAction, registerMultibufferFindImplementations, SearchInMultibufferAction, ShowExcerptsAction, ShowMatchLinesOnlyAction } from './multibufferActions.js';
import { MultibufferEditor } from './multibufferEditor.js';
import { MultibufferEditorInput } from './multibufferEditorInput.js';
import './multibufferColors.js';

// The editor of multibuffers. Their inputs have no serializer: a multibuffer is gone after a reload
Registry.as<IEditorPaneRegistry>(EditorExtensions.EditorPane).registerEditorPane(
	EditorPaneDescriptor.create(MultibufferEditor, MultibufferEditor.ID, localize('multibuffer.editorName', "Multibuffer")),
	[new SyncDescriptor(MultibufferEditorInput)],
);

registerAction2(FindReferencesInMultibufferAction);
registerAction2(SearchInMultibufferAction);
registerAction2(FindInMultibufferAction);
registerAction2(FindNextInMultibufferAction);
registerAction2(FindPreviousInMultibufferAction);
registerAction2(CloseFindInMultibufferAction);
registerMultibufferFindImplementations();
registerAction2(OpenMultibufferFileAction);
registerAction2(OpenMultibufferFileToSideAction);
registerAction2(ExpandExcerptUpAction);
registerAction2(ExpandExcerptDownAction);
registerAction2(ShowMatchLinesOnlyAction);
registerAction2(ShowExcerptsAction);

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'vsade.multibuffer',
	title: localize('multibufferConfigurationTitle', "Multibuffer"),
	type: 'object',
	properties: {
		[MultibufferSettingId.ContextLines]: {
			type: 'integer',
			default: 6,
			minimum: 0,
			maximum: 100,
			markdownDescription: localize('multibuffer.contextLines', "The number of lines a multibuffer shows above and below each match. Excerpts that overlap or touch merge into one. Applies to the multibuffers opened after it changes."),
		},
		[MultibufferSettingId.ExpandLines]: {
			type: 'integer',
			default: 20,
			minimum: 1,
			maximum: 1000,
			markdownDescription: localize('multibuffer.expandLines', "The number of hidden lines a multibuffer shows each time an excerpt is expanded up or down."),
		},
		[MultibufferSettingId.MaxResults]: {
			type: 'integer',
			default: 5000,
			minimum: 1,
			markdownDescription: localize('multibuffer.maxResults', "The most matches a text search multibuffer shows."),
		},
		[MultibufferSettingId.DoubleClickBehaviour]: {
			type: 'string',
			enum: [MultibufferDoubleClickBehaviour.SelectWord, MultibufferDoubleClickBehaviour.OpenFile, MultibufferDoubleClickBehaviour.OpenFileToSide],
			default: MultibufferDoubleClickBehaviour.OpenFile,
			enumDescriptions: [
				localize('multibuffer.doubleClickBehaviour.selectWord', "Double-clicking selects the word under the cursor."),
				localize('multibuffer.doubleClickBehaviour.openFile', "Double-clicking opens the file at the clicked position in the active editor group."),
				localize('multibuffer.doubleClickBehaviour.openFileToSide', "Double-clicking opens the file at the clicked position in the editor group to the side."),
			],
			markdownDescription: localize('multibuffer.doubleClickBehaviour', "Controls what double-clicking a line of a multibuffer does. Double-clicking the header of a file always opens the file, to the side when this is `openFileToSide`."),
		},
	},
});
