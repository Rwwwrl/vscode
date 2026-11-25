/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable } from '../../../../../base/common/lifecycle.js';
import { isEqual } from '../../../../../base/common/resources.js';
import { URI, UriComponents } from '../../../../../base/common/uri.js';
import { CommandsRegistry, ICommandHandler } from '../../../../../platform/commands/common/commands.js';
import { ITextEditorOptions } from '../../../../../platform/editor/common/editor.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { API_OPEN_WITH_EDITOR_COMMAND_ID } from '../../../../browser/parts/editor/editorCommands.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { EditorGroupColumn, editorGroupToColumn } from '../../../../services/editor/common/editorGroupColumn.js';
import { IEditorGroup, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { ACTIVE_GROUP, IEditorService } from '../../../../services/editor/common/editorService.js';
import { IAgentDockService } from './agentDockService.js';

/**
 * Keeps a tab of the dock in the dock when an extension opens its resource again with `vscode.openWith` and no column,
 * which would move it to the active group: an editor that takes one tab per resource, such as a custom editor, moves to
 * where it opens. The Codex extension does that for each of its tabs once it starts, to restore them.
 *
 * The command opens such a resource in the group of the dock that holds it instead, and, when the extension preserves
 * the focus, shows the group's active tab again after.
 */
export class AgentDockOpenWithContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'vsade.agentDock.openWith';

	constructor(
		@IAgentDockService agentDockService: IAgentDockService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IEditorService private readonly editorService: IEditorService,
	) {
		super();

		const openWith = CommandsRegistry.getCommand(API_OPEN_WITH_EDITOR_COMMAND_ID);
		if (!openWith) {
			return;
		}

		// The registration takes over the command until it is disposed, when the command's own comes back
		this._register(CommandsRegistry.registerCommand(API_OPEN_WITH_EDITOR_COMMAND_ID, (accessor, resource: UriComponents, id: string, columnAndOptions?: [EditorGroupColumn?, ITextEditorOptions?]) => {
			const [column, options] = columnAndOptions ?? [];
			if (column !== undefined && column !== ACTIVE_GROUP) {
				return openWith.handler(accessor, resource, id, columnAndOptions);
			}

			const uri = URI.revive(resource);
			for (const group of agentDockService.getPart().part.groups) {
				const editor = group.editors.find(candidate => candidate.editorId === id && isEqual(candidate.resource, uri));
				if (editor) {
					return this.openInDock(accessor, openWith.handler, resource, id, editor, group, options);
				}
			}

			return openWith.handler(accessor, resource, id, columnAndOptions);
		}));
	}

	private async openInDock(accessor: ServicesAccessor, handler: ICommandHandler, resource: UriComponents, id: string, editor: EditorInput, group: IEditorGroup, options: ITextEditorOptions | undefined): Promise<void> {
		const previous = group.activeEditor;
		await handler(accessor, resource, id, [editorGroupToColumn(this.editorGroupsService, group), options]);

		// The tab shows, as the extension asks for: a webview starts only once it shows, and a custom editor takes its
		// title from the extension only once it starts. A tab that was in the background goes back there.
		if (options?.preserveFocus && previous && previous !== editor && group.activeEditor === editor && group.contains(previous)) {
			await this.editorService.openEditor(previous, { preserveFocus: true }, group);
		}
	}
}
