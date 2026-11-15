/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { $ } from '../../../../../base/browser/dom.js';
import { disposableTimeout } from '../../../../../base/common/async.js';
import { Event } from '../../../../../base/common/event.js';
import { Disposable, DisposableStore } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { ICommandService } from '../../../../../platform/commands/common/commands.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IStorageService, StorageScope, StorageTarget } from '../../../../../platform/storage/common/storage.js';
import { IEditorGroupViewOptions } from '../../../../browser/parts/editor/editor.js';
import { GroupModelChangeKind } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../../common/views.js';
import { editorGroupToColumn } from '../../../../services/editor/common/editorGroupColumn.js';
import { GroupsOrder, IContentPart, IEditorGroup, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorsChangeEvent, IEditorService } from '../../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService, Parts } from '../../../../services/layout/browser/layoutService.js';
import { IViewsService } from '../../../../services/views/common/viewsService.js';
import { WebviewInput } from '../../../webviewPanel/browser/webviewEditorInput.js';
import { AGENT_DOCK_VIEW_ID, AgentDockGroupContext, AgentDockSettingId, CLAUDE_CODE_OPEN_EDITOR_COMMAND_ID, CLAUDE_CODE_WEBVIEW_VIEW_TYPE, IAgentDockEditorDescriptor, isAgentDockEditor, isAgentDockWebview } from '../../common/agentDock/agentDock.js';

export const IAgentDockService = createDecorator<IAgentDockService>('vsadeAgentDockService');

/** The editor part of the Agent Dock and its root element, which the dock's view shows. */
export interface IAgentDockPart {
	readonly part: IContentPart;
	readonly element: HTMLElement;
}

/**
 * The Agent Dock: an editor part in a view that holds only terminals and the webview panels of agents, such as Claude
 * Code, as tabs. Its groups stay locked, so other editors open in the editor area; one that lands there all the same,
 * such as by a drop, moves to the editor area.
 */
export interface IAgentDockService {
	readonly _serviceBrand: undefined;

	/**
	 * The editor part of the dock, created on first use with the editors it had when the window last closed. It lives
	 * as long as the window, whether the dock's view shows it or not.
	 */
	getPart(): IAgentDockPart;

	/**
	 * Restores the dock's editors, unless that happened already. Called at startup, also while the dock is hidden: the
	 * dock's terminals must reconnect to their processes before the terminal host gives up on them.
	 */
	restore(): void;

	/** Whether `group` is a group of the dock. */
	isDockGroup(group: IEditorGroup): boolean;

	/** Shows the dock and returns its active group. */
	reveal(focus: boolean): Promise<IEditorGroup | undefined>;

	/**
	 * Hides the dock when it shows. Otherwise shows and focuses it, with a new Claude Code conversation when it has
	 * none.
	 */
	toggle(): Promise<void>;

	/** Opens a new Claude Code conversation in the dock. */
	openClaudeCode(): Promise<void>;
}

/** How long {@link IAgentDockService.openClaudeCode} waits for the Claude Code panel to open. */
const EXPECT_WEBVIEW_TIMEOUT = 10_000;

const STATE_STORAGE_KEY = 'vsade.agentDock.state';

/** The groups of the dock show no lock actions: they stay locked. */
const GROUP_VIEW_OPTIONS: IEditorGroupViewOptions = { hideLockActions: true };

export class AgentDockService extends Disposable implements IAgentDockService {

	declare readonly _serviceBrand: undefined;

	private dock: IAgentDockPart | undefined;

	/** Editors seen open somewhere: only an editor that opens for the first time moves into the dock by itself. */
	private readonly seenEditors = new WeakSet<EditorInput>();

	private expectWebviewUntil = 0;

	private readonly pendingMoves = this._register(new DisposableStore());

	constructor(
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IEditorService private readonly editorService: IEditorService,
		@IViewsService private readonly viewsService: IViewsService,
		@IViewDescriptorService private readonly viewDescriptorService: IViewDescriptorService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IStorageService private readonly storageService: IStorageService,
		@ICommandService private readonly commandService: ICommandService,
		@INotificationService private readonly notificationService: INotificationService,
	) {
		super();

		for (const group of this.editorGroupsService.groups) {
			this.seeEditorsOf(group);
		}

		this._register(this.editorService.onDidEditorsChange(e => this.onDidEditorsChange(e)));
		this._register(this.storageService.onWillSaveState(() => this.saveState()));
	}

	private get part(): IContentPart | undefined {
		return this.dock?.part;
	}

	restore(): void {
		this.getPart();
	}

	getPart(): IAgentDockPart {
		if (this.dock) {
			return this.dock;
		}

		// The view takes the element in when it renders; until then the part shows nowhere
		const element = $('.vsade-agent-dock-part');
		const part = this.editorGroupsService.createEditorPart({
			container: element,
			label: localize('agentDock.part', "Agent Dock"),
			state: this.loadState(),
			groupViewOptions: GROUP_VIEW_OPTIONS,
		});
		part.setVisible(false);
		this.dock = { part, element };

		// Tabs only, never a preview tab, and no group left behind empty by an editor that moved out
		this._register(part.enforcePartOptions({ enablePreview: false, showTabs: 'multiple', closeEmptyGroups: true }));

		for (const group of part.groups) {
			this.seeEditorsOf(group);
			this.setUpGroup(group);
		}
		this._register(part.onDidAddGroup(group => this.setUpGroup(group)));

		// On shutdown the editor parts service releases the part, and its editors come back from the saved state
		this._register(Event.once(part.onWillClose)(() => this.dock = undefined));

		return this.dock;
	}


	isDockGroup(group: IEditorGroup): boolean {
		return !!this.part && this.part.groups.some(candidate => candidate.id === group.id);
	}

	async reveal(focus: boolean): Promise<IEditorGroup | undefined> {
		await this.viewsService.openView(AGENT_DOCK_VIEW_ID, focus);

		return this.part?.activeGroup;
	}

	async toggle(): Promise<void> {
		if (!this.viewsService.isViewVisible(AGENT_DOCK_VIEW_ID)) {
			await this.reveal(true);
			if (!this.hasClaudeCode()) {
				await this.openClaudeCode();
			}
			return;
		}

		switch (this.viewDescriptorService.getViewLocationById(AGENT_DOCK_VIEW_ID)) {
			case ViewContainerLocation.Sidebar:
				this.layoutService.setPartHidden(true, Parts.SIDEBAR_PART);
				break;
			case ViewContainerLocation.Panel:
				this.layoutService.setPartHidden(true, Parts.PANEL_PART);
				break;
			default:
				this.layoutService.setPartHidden(true, Parts.AUXILIARYBAR_PART);
				break;
		}
	}

	async openClaudeCode(): Promise<void> {
		const group = await this.reveal(false);
		if (!group) {
			return;
		}

		// Claude Code takes the column to open in as its third argument, a `ViewColumn` of the extension API, which
		// counts from 1. Without one, while no group holds a Claude Code tab, it adds a group for the tab first, which
		// would split the dock for a moment.
		const viewColumn = editorGroupToColumn(this.editorGroupsService, group) + 1;

		// Should it open elsewhere all the same, the panel moves into the dock even when the setting to move agent
		// panels there is off
		this.expectWebviewUntil = Date.now() + EXPECT_WEBVIEW_TIMEOUT;
		try {
			await this.commandService.executeCommand(CLAUDE_CODE_OPEN_EDITOR_COMMAND_ID, undefined, undefined, viewColumn);
		} catch {
			this.expectWebviewUntil = 0;
			this.notificationService.error(localize('agentDock.claudeCodeMissing', "Could not open Claude Code. Make sure the Claude Code extension is installed and enabled."));
		}
	}

	private hasClaudeCode(): boolean {
		return !!this.part?.groups.some(group => group.editors.some(editor => isAgentDockWebview(this.describe(editor), [CLAUDE_CODE_WEBVIEW_VIEW_TYPE])));
	}

	/** The group of the editor area that editors leaving the dock go to: the most recently active unlocked one. */
	private findEditorAreaGroup(): IEditorGroup {
		const mainPart = this.editorGroupsService.mainPart;
		return mainPart.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE).find(candidate => !candidate.isLocked) ?? mainPart.activeGroup;
	}

	//#region Keep the dock to its editors

	private onDidEditorsChange({ groupId, event }: IEditorsChangeEvent): void {
		const group = this.editorGroupsService.getGroup(groupId);
		if (!group) {
			return;
		}

		const inDock = this.isDockGroup(group);

		// A group of the dock that something unlocked locks again
		if (event.kind === GroupModelChangeKind.GROUP_LOCKED) {
			if (inDock && !group.isLocked) {
				group.lock(true);
			}
			return;
		}

		if (event.kind !== GroupModelChangeKind.EDITOR_OPEN || !event.editor) {
			return;
		}

		const editor = event.editor;
		const firstSeen = !this.seenEditors.has(editor);
		this.seenEditors.add(editor);

		// The move waits for the open to finish, which fires this event while it is under way
		if (inDock) {
			if (!isAgentDockEditor(this.describe(editor), this.webviews)) {
				disposableTimeout(() => this.moveOutOfDock(group, editor), 0, this.pendingMoves);
			} else if (firstSeen) {
				const target = this.findGroupForNewTab(group, editor);
				if (target) {
					disposableTimeout(() => this.moveToGroup(group, editor, target), 0, this.pendingMoves);
				}
			}
		} else if (firstSeen && this.shouldCapture(editor)) {
			disposableTimeout(() => this.moveIntoDock(group, editor), 0, this.pendingMoves);
		}
	}

	private shouldCapture(editor: EditorInput): boolean {
		if (!isAgentDockWebview(this.describe(editor), this.webviews)) {
			return false;
		}

		if (Date.now() < this.expectWebviewUntil) {
			this.expectWebviewUntil = 0;
			return true;
		}

		return this.configurationService.getValue<boolean>(AgentDockSettingId.CaptureWebviews) !== false;
	}

	private moveOutOfDock(group: IEditorGroup, editor: EditorInput): void {
		if (!group.contains(editor, { strictEquals: true }) || !this.isDockGroup(group)) {
			return;
		}

		const target = this.findEditorAreaGroup();
		const focus = this.editorGroupsService.activeGroup === group && group.activeEditor === editor;
		group.moveEditor(editor, target, { pinned: true });
		if (focus) {
			target.focus();
		}
	}

	/**
	 * The group of the dock that a tab opening there for the first time belongs in, when not the one it opened in:
	 * - another group that is empty, such as the dock's only group, when an extension opens the tab in a new column,
	 *   which goes beside the last group;
	 * - the most recently active other group, for an agent panel that opens alone in a new group, such as when Claude
	 *   Code opens a new conversation in a new column. A split by the user never opens one there: agent panels cannot be
	 *   copied, so the split starts empty. A terminal split by the user opens a new terminal alone in a new group, and
	 *   stays.
	 */
	private findGroupForNewTab(group: IEditorGroup, editor: EditorInput): IEditorGroup | undefined {
		const others = this.part?.getGroups(GroupsOrder.MOST_RECENTLY_ACTIVE).filter(candidate => candidate.id !== group.id) ?? [];
		const emptyGroup = others.find(candidate => candidate.isEmpty);
		if (emptyGroup) {
			return emptyGroup;
		}

		if (group.count === 1 && isAgentDockWebview(this.describe(editor), this.webviews)) {
			return others[0];
		}

		return undefined;
	}

	/** Moves a tab between groups of the dock; the group it leaves closes once empty. */
	private moveToGroup(group: IEditorGroup, editor: EditorInput, target: IEditorGroup): void {
		if (!this.isDockGroup(target) || !this.isDockGroup(group) || !group.contains(editor, { strictEquals: true })) {
			return;
		}

		const focus = this.editorGroupsService.activeGroup === group && group.activeEditor === editor;
		group.moveEditor(editor, target, { pinned: true });
		if (focus) {
			target.focus();
		}
	}

	private async moveIntoDock(group: IEditorGroup, editor: EditorInput): Promise<void> {
		const focus = this.editorGroupsService.activeGroup === group && group.activeEditor === editor;
		const target = await this.reveal(false);
		if (!target || target.id === group.id || !group.contains(editor, { strictEquals: true })) {
			return;
		}

		group.moveEditor(editor, target, { pinned: true });
		if (focus) {
			target.focus();
		}
	}

	/** Locks a group of the dock, and tells its tab bar's actions that it is one. */
	private setUpGroup(group: IEditorGroup): void {
		if (!group.isLocked) {
			group.lock(true);
		}
		AgentDockGroupContext.bindTo(group.scopedContextKeyService).set(true);
	}

	private seeEditorsOf(group: IEditorGroup): void {
		for (const editor of group.editors) {
			this.seenEditors.add(editor);
		}
	}

	private describe(editor: EditorInput): IAgentDockEditorDescriptor {
		return { typeId: editor.typeId, viewType: editor instanceof WebviewInput ? editor.viewType : undefined };
	}

	private get webviews(): readonly string[] {
		const value = this.configurationService.getValue<unknown>(AgentDockSettingId.Webviews);
		return Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string') : [];
	}

	//#endregion

	//#region State

	private loadState(): unknown {
		const raw = this.storageService.get(STATE_STORAGE_KEY, StorageScope.WORKSPACE);
		if (!raw) {
			return undefined;
		}

		try {
			return JSON.parse(raw);
		} catch {
			return undefined;
		}
	}

	private saveState(): void {
		const part = this.part;
		if (!part) {
			return; // not restored yet, or released on shutdown already: keep what it had
		}

		if (part.groups.every(group => group.isEmpty)) {
			this.storageService.remove(STATE_STORAGE_KEY, StorageScope.WORKSPACE);
		} else {
			this.storageService.store(STATE_STORAGE_KEY, JSON.stringify(part.createState()), StorageScope.WORKSPACE, StorageTarget.MACHINE);
		}
	}

	//#endregion
}
