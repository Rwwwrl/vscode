/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { Event } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { localize, localize2 } from '../../../../../nls.js';
import { Categories } from '../../../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { ContextKeyExpr, IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../../editor/browser/editorExtensions.js';
import { ICodeEditorService } from '../../../../../editor/browser/services/codeEditorService.js';
import { IModelService } from '../../../../../editor/common/services/model.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../../browser/parts/views/viewPaneContainer.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../../common/views.js';
import { editorGroupToColumn } from '../../../../services/editor/common/editorGroupColumn.js';
import { IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { ITerminalService } from '../../../terminal/browser/terminal.js';
import { AGENT_DOCK_CONTAINER_ID, AGENT_DOCK_VIEW_ID, AgentDockActiveContext, AgentDockActiveEditorAreaGroupLastContext, AgentDockAvailableContext, AgentDockCommandId, AgentDockGroupContext, AgentDockSelectionBadgeMode, AgentDockSettingId, AgentDockTerminalSelectionDrop, CLAUDE_CODE_WEBVIEW_VIEW_TYPE } from '../../common/agentDock/agentDock.js';
import { IAgentDockSelection } from '../../common/agentDock/agentDockDrop.js';
import { AgentDockInsertService, IAgentDockInsertService } from './agentDockInsertService.js';
import { AgentDockMarkdownPreviewFocusTracker, isAgentDockMarkdownPreview, requestAgentDockPreviewSelection } from './agentDockPreviewSelection.js';
import { AgentDockSelectionBadge, getAgentDockEditorSelection } from './agentDockSelectionBadge.js';
import { AgentDockService, IAgentDockService } from './agentDockService.js';
import { AgentDockViewPane } from './agentDockView.js';

registerSingleton(IAgentDockService, AgentDockService, InstantiationType.Delayed);
registerSingleton(IAgentDockInsertService, AgentDockInsertService, InstantiationType.Delayed);

// The badge next to a selection, which drags a reference to it into the dock
registerEditorContribution(AgentDockSelectionBadge.ID, AgentDockSelectionBadge, EditorContributionInstantiation.AfterFirstRender);

//#region View

const agentDockIcon = registerIcon('vsade-agent-dock-view-icon', Codicon.layers, localize('agentDockViewIcon', "View icon of the Agent Dock view."));

const container = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: AGENT_DOCK_CONTAINER_ID,
	title: localize2('agentDock', "Agent Dock"),
	icon: agentDockIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [AGENT_DOCK_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: AGENT_DOCK_CONTAINER_ID,
	hideIfEmpty: false,
	order: 100,
}, ViewContainerLocation.AuxiliaryBar);

const viewsRegistry = Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry);

viewsRegistry.registerViews([{
	id: AGENT_DOCK_VIEW_ID,
	name: localize2('agentDockView', "Agent Dock"),
	containerIcon: agentDockIcon,
	ctorDescriptor: new SyncDescriptor(AgentDockViewPane),
	canToggleVisibility: false,
	canMoveView: false,
}], container);

viewsRegistry.registerViewWelcomeContent(AGENT_DOCK_VIEW_ID, {
	content: localize(
		{ key: 'agentDock.welcome', comment: ['{0} and {1} are command ids of links; do not translate them'] },
		"Terminals and Claude Code conversations open here as tabs. Files always open in the editor area.\n[New Terminal](command:{0})\n[New Claude Code](command:{1})",
		AgentDockCommandId.NewTerminal,
		AgentDockCommandId.NewClaudeCode,
	),
});

//#endregion

//#region Settings

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'vsade.agentDock',
	title: localize('agentDockConfigurationTitle', "Agent Dock"),
	type: 'object',
	properties: {
		[AgentDockSettingId.Webviews]: {
			type: 'array',
			items: { type: 'string' },
			default: [CLAUDE_CODE_WEBVIEW_VIEW_TYPE],
			markdownDescription: localize('agentDock.webviews', "The webview panels of extensions, by their view type, that the Agent Dock holds besides terminals. Any other editor that lands in the Agent Dock moves to the editor area."),
		},
		[AgentDockSettingId.CaptureWebviews]: {
			type: 'boolean',
			default: true,
			markdownDescription: localize('agentDock.captureWebviews', "Controls whether a new webview panel listed in `#{0}#` moves into the Agent Dock when it opens in the editor area.", AgentDockSettingId.Webviews),
		},
		[AgentDockSettingId.SelectionBadge]: {
			type: 'string',
			enum: [AgentDockSelectionBadgeMode.Mouse, AgentDockSelectionBadgeMode.Always, AgentDockSelectionBadgeMode.Off],
			enumDescriptions: [
				localize('agentDock.selectionBadge.mouse', "Show the badge next to selections made with the mouse."),
				localize('agentDock.selectionBadge.always', "Show the badge next to every selection, also one made with the keyboard."),
				localize('agentDock.selectionBadge.off', "Never show the badge."),
			],
			default: AgentDockSelectionBadgeMode.Mouse,
			markdownDescription: localize('agentDock.selectionBadgeSetting', "Controls when a badge shows next to the selection of a file in an editor. Dragging the badge onto a terminal or Claude Code in the Agent Dock inserts a reference to the selected lines."),
		},
		[AgentDockSettingId.TerminalSelectionDrop]: {
			type: 'string',
			enum: [AgentDockTerminalSelectionDrop.Reference, AgentDockTerminalSelectionDrop.Text],
			enumDescriptions: [
				localize('agentDock.terminalSelectionDrop.reference', "Insert a reference to the selected lines, such as `@src/a.ts#L3-5`, as the command line of Claude Code reads it."),
				localize('agentDock.terminalSelectionDrop.text', "Insert the selected text."),
			],
			default: AgentDockTerminalSelectionDrop.Reference,
			markdownDescription: localize('agentDock.terminalSelectionDropSetting', "Controls what a terminal of the Agent Dock gets when a selection is dragged onto it by its badge (`#{0}#`).", AgentDockSettingId.SelectionBadge),
		},
	},
});

//#endregion

//#region Actions

class ToggleAgentDockAction extends Action2 {
	constructor() {
		super({
			id: AgentDockCommandId.Toggle,
			title: localize2('agentDock.toggle', "Toggle Agent Dock"),
			category: Categories.View,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IAgentDockService).toggle();
	}
}

/**
 * Focuses the tab of the dock that was active last, as `vsade.agentDock.insertSelection` finds it, and shows the dock
 * first when it is hidden.
 */
class FocusAgentDockAction extends Action2 {
	constructor() {
		super({
			id: AgentDockCommandId.Focus,
			title: localize2('agentDock.focus', "Focus Agent Dock"),
			category: Categories.View,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IAgentDockService).focusLastActive();
	}
}

/** Focuses the group of the editor area that was active last, such as to go back from the dock. */
class FocusEditorAreaAction extends Action2 {
	constructor() {
		super({
			id: AgentDockCommandId.FocusEditorArea,
			title: localize2('agentDock.focusEditorArea', "Focus Editor Area"),
			category: Categories.View,
			f1: true,
		});
	}

	run(accessor: ServicesAccessor): void {
		accessor.get(IEditorGroupsService).mainPart.activeGroup.focus();
	}
}

class NewTerminalInAgentDockAction extends Action2 {
	constructor() {
		super({
			id: AgentDockCommandId.NewTerminal,
			title: localize2('agentDock.newTerminal', "New Terminal in Agent Dock"),
			category: Categories.View,
			icon: Codicon.terminal,
			f1: true,
			menu: [{
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.equals('view', AGENT_DOCK_VIEW_ID),
				group: 'navigation',
				order: 1,
			}, {
				// The tab bar of the dock, first among the actions of its tabs
				id: MenuId.EditorTitle,
				when: AgentDockGroupContext,
				group: 'navigation',
				order: -2,
			}],
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const agentDockService = accessor.get(IAgentDockService);
		const terminalService = accessor.get(ITerminalService);
		const editorGroupsService = accessor.get(IEditorGroupsService);

		const group = await agentDockService.reveal(false);
		if (group) {
			// An explicit group, which the terminal service takes as a column: the dock's groups are locked for any
			// other way of opening
			await terminalService.createTerminal({ location: { viewColumn: editorGroupToColumn(editorGroupsService, group) } });
		}
	}
}

class NewClaudeCodeInAgentDockAction extends Action2 {
	constructor() {
		super({
			id: AgentDockCommandId.NewClaudeCode,
			title: localize2('agentDock.newClaudeCode', "New Claude Code in Agent Dock"),
			category: Categories.View,
			icon: Codicon.claude,
			f1: true,
			// The dock's tab bar has Claude Code's own Open button instead
			menu: {
				id: MenuId.ViewTitle,
				when: ContextKeyExpr.equals('view', AGENT_DOCK_VIEW_ID),
				group: 'navigation',
				order: 2,
			},
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		await accessor.get(IAgentDockService).openClaudeCode();
	}
}

/**
 * Inserts a reference to the selected lines into the tab of the dock that was active last, a terminal or Claude Code, as a
 * drag of the selection's badge onto it does: the lines of the focused editor, or the source lines of the blocks
 * selected in a focused Markdown preview; else of the active one.
 */
class InsertSelectionIntoAgentDockAction extends Action2 {
	constructor() {
		super({
			id: AgentDockCommandId.InsertSelection,
			title: localize2('agentDock.insertSelection', "Insert Selection into Agent Dock"),
			category: Categories.View,
			f1: true,
		});
	}

	async run(accessor: ServicesAccessor): Promise<void> {
		const agentDockInsertService = accessor.get(IAgentDockInsertService);
		const notificationService = accessor.get(INotificationService);
		const codeEditorService = accessor.get(ICodeEditorService);
		const editorService = accessor.get(IEditorService);
		const modelService = accessor.get(IModelService);

		const selection = await this.resolveSelection(codeEditorService, editorService, modelService);
		if (selection === 'nothing') {
			notificationService.info(localize('agentDock.insertSelectionNothing', "Select lines of a file, or blocks of a Markdown preview, to insert a reference to them into the Agent Dock."));
			return;
		}

		await agentDockInsertService.insertIntoLastActive({ kind: 'selection', selection });
	}

	private async resolveSelection(codeEditorService: ICodeEditorService, editorService: IEditorService, modelService: IModelService): Promise<IAgentDockSelection | 'nothing'> {
		const codeEditor = codeEditorService.getFocusedCodeEditor() ?? codeEditorService.getActiveCodeEditor();
		if (codeEditor && !(codeEditor.getSelection()?.isEmpty() ?? true)) {
			return getAgentDockEditorSelection(codeEditor) ?? 'nothing';
		}

		const preview = editorService.visibleEditors.find(editor => isAgentDockMarkdownPreview(editor) && editor.webview.isFocused) ?? editorService.activeEditor;
		if (isAgentDockMarkdownPreview(preview)) {
			return await requestAgentDockPreviewSelection(preview, modelService) ?? 'nothing';
		}

		return 'nothing';
	}
}

registerAction2(ToggleAgentDockAction);
registerAction2(FocusAgentDockAction);
registerAction2(FocusEditorAreaAction);
registerAction2(NewTerminalInAgentDockAction);
registerAction2(NewClaudeCodeInAgentDockAction);
registerAction2(InsertSelectionIntoAgentDockAction);

//#endregion

/**
 * Restores the dock once the workbench restored, also while it is hidden, so that its terminals reconnect to their
 * processes in time, and so that agent panels move into the dock as they open. Tells keybindings the dock exists, and
 * whether the active editor group is one of the dock or the last one of the editor area.
 */
class AgentDockContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'vsade.agentDock';

	constructor(
		@IAgentDockService agentDockService: IAgentDockService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IEditorGroupsService editorGroupsService: IEditorGroupsService,
	) {
		super();

		AgentDockAvailableContext.bindTo(contextKeyService).set(true);
		agentDockService.restore();

		const active = AgentDockActiveContext.bindTo(contextKeyService);
		const activeEditorAreaGroupLast = AgentDockActiveEditorAreaGroupLastContext.bindTo(contextKeyService);
		const mainPart = editorGroupsService.mainPart;
		const update = () => {
			const activeGroup = editorGroupsService.activeGroup;
			active.set(agentDockService.isDockGroup(activeGroup));
			activeEditorAreaGroupLast.set(mainPart.activeGroup === activeGroup && activeGroup.index === mainPart.count - 1);
		};
		update();
		this._register(Event.any(editorGroupsService.onDidChangeActiveGroup, mainPart.onDidAddGroup, mainPart.onDidRemoveGroup, mainPart.onDidChangeGroupIndex)(update));
	}
}

registerWorkbenchContribution2(AgentDockContribution.ID, AgentDockContribution, WorkbenchPhase.AfterRestored);
registerWorkbenchContribution2(AgentDockMarkdownPreviewFocusTracker.ID, AgentDockMarkdownPreviewFocusTracker, WorkbenchPhase.AfterRestored);
