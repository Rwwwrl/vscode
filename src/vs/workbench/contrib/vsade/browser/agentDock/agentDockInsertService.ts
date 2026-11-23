/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { DeferredPromise, raceTimeout } from '../../../../../base/common/async.js';
import { DisposableStore } from '../../../../../base/common/lifecycle.js';
import { URI } from '../../../../../base/common/uri.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IFileService } from '../../../../../platform/files/common/files.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { GroupModelChangeKind } from '../../../../common/editor.js';
import { EditorInput } from '../../../../common/editor/editorInput.js';
import { IEditorGroup, IEditorGroupsService } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { TerminalEditorInput } from '../../../terminal/browser/terminalEditorInput.js';
import { WebviewInput } from '../../../webviewPanel/browser/webviewEditorInput.js';
import { AgentDockSettingId, AgentDockTerminalSelectionDrop } from '../../common/agentDock/agentDock.js';
import { AgentDockDropTargetKind, createClaudeCodeInsertAtMentionMessage, getAgentDockDropTargetKind, getAgentDockMention, getAgentDockRelativePath, getAgentDockSelectionMention, getAgentDockTerminalPath, IAgentDockSelection, locateAgentDockSelection } from '../../common/agentDock/agentDockDrop.js';
import { describeAgentDockEditor, IAgentDockService } from './agentDockService.js';

export const IAgentDockInsertService = createDecorator<IAgentDockInsertService>('vsadeAgentDockInsertService');

/** What goes into a tab of the dock: files, or the selection of an editor. */
export type AgentDockInsertPayload =
	| { readonly kind: 'resources'; readonly resources: readonly URI[] }
	| { readonly kind: 'selection'; readonly selection: IAgentDockSelection };

/**
 * Inserts references to files and to selected lines into the tabs of the Agent Dock: a terminal gets them typed in, and
 * Claude Code an @-mention of each in its chat input.
 */
export interface IAgentDockInsertService {
	readonly _serviceBrand: undefined;

	/** Inserts `payload` into the active tab of `group`, a group of the dock, and focuses it. */
	insert(group: IEditorGroup, payload: AgentDockInsertPayload): Promise<void>;

	/**
	 * Inserts `payload` into the tab of the dock that was active last among those that take it, a terminal or Claude
	 * Code. The dock shows first; without such a tab, a new Claude Code conversation opens and takes it.
	 */
	insertIntoLastActive(payload: AgentDockInsertPayload): Promise<void>;
}

/** How long {@link IAgentDockInsertService.insertIntoLastActive} waits for a new Claude Code tab to open. */
const OPEN_TIMEOUT = 10_000;

/**
 * How long it then waits for the panel to start, which it tells with its first message: the panel misses what is posted
 * to it earlier. The Claude Code extension waits the same way for its own "Insert @-Mention" command.
 */
const READY_TIMEOUT = 10_000;

export class AgentDockInsertService implements IAgentDockInsertService {

	declare readonly _serviceBrand: undefined;

	constructor(
		@IAgentDockService private readonly agentDockService: IAgentDockService,
		@IEditorGroupsService private readonly editorGroupsService: IEditorGroupsService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@INotificationService private readonly notificationService: INotificationService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IFileService private readonly fileService: IFileService,
	) { }

	async insert(group: IEditorGroup, payload: AgentDockInsertPayload): Promise<void> {
		const editor = group.activeEditor;
		if (!editor) {
			return;
		}

		this.editorGroupsService.activateGroup(group);
		group.focus();

		const kind = getAgentDockDropTargetKind(describeAgentDockEditor(editor));
		if (kind === AgentDockDropTargetKind.Terminal && editor instanceof TerminalEditorInput) {
			if (payload.kind === 'selection') {
				await this.insertSelectionIntoTerminal(editor, payload.selection);
			} else {
				await this.insertIntoTerminal(editor, payload.resources);
			}
		} else if (kind === AgentDockDropTargetKind.ClaudeCode && editor instanceof WebviewInput) {
			if (payload.kind === 'selection') {
				await this.insertSelectionIntoClaudeCode(editor, payload.selection);
			} else {
				await this.insertIntoClaudeCode(editor, payload.resources);
			}
		}
	}

	async insertIntoLastActive(payload: AgentDockInsertPayload): Promise<void> {
		await this.agentDockService.reveal(true);

		const group = this.findLastActiveGroup() ?? await this.openClaudeCode();
		if (group) {
			await this.insert(group, payload);
		}
	}

	/** The most recently active group of the dock whose active tab takes references, a terminal or Claude Code. */
	private findLastActiveGroup(): IEditorGroup | undefined {
		return this.agentDockService.getLastActiveGroup(editor => !!getAgentDockDropTargetKind(describeAgentDockEditor(editor)));
	}

	/** Opens a new Claude Code conversation in the dock, and returns its group once the panel started. */
	private async openClaudeCode(): Promise<IEditorGroup | undefined> {
		const store = new DisposableStore();
		try {
			const opened = new DeferredPromise<WebviewInput>();
			const ready = new DeferredPromise<void>();

			// Listens from the start: the panel can open, and post its first message, before the command returns
			store.add(this.editorService.onDidEditorsChange(({ groupId, event }) => {
				const group = this.editorGroupsService.getGroup(groupId);
				const editor = event.editor;
				if (opened.isSettled || event.kind !== GroupModelChangeKind.EDITOR_OPEN || !group || !this.agentDockService.isDockGroup(group)
					|| !(editor instanceof WebviewInput) || getAgentDockDropTargetKind(describeAgentDockEditor(editor)) !== AgentDockDropTargetKind.ClaudeCode) {
					return;
				}

				store.add(editor.webview.onMessage(() => ready.complete()));
				opened.complete(editor);
			}));

			await this.agentDockService.openClaudeCode();

			const editor = await raceTimeout(opened.p, OPEN_TIMEOUT);
			if (!editor) {
				return undefined;
			}

			await raceTimeout(ready.p, READY_TIMEOUT);

			// The dock can have moved the tab to another of its groups since it opened
			return this.findGroupOf(editor);
		} finally {
			store.dispose();
		}
	}

	private findGroupOf(editor: EditorInput): IEditorGroup | undefined {
		return this.agentDockService.getPart().part.groups.find(group => group.activeEditor === editor);
	}

	/** Pastes the paths, as a drop of files into a terminal of the system does, followed by a space to type on. */
	private async insertIntoTerminal(editor: TerminalEditorInput, resources: readonly URI[]): Promise<void> {
		const instance = editor.terminalInstance;
		if (!instance) {
			return;
		}

		const paths = await Promise.all(resources.map(resource => instance.preparePathForShell(resource.fsPath)));
		await instance.sendText(`${paths.join(' ')} `, false, true);
	}

	/**
	 * Types an @-mention of the selected lines for the command line of Claude Code, followed by a space to type on, or the
	 * selected text itself, as `vsade.agentDock.terminalSelectionDrop` says.
	 */
	private async insertSelectionIntoTerminal(editor: TerminalEditorInput, selection: IAgentDockSelection): Promise<void> {
		const instance = editor.terminalInstance;
		if (!instance) {
			return;
		}

		if (this.configurationService.getValue<string>(AgentDockSettingId.TerminalSelectionDrop) === AgentDockTerminalSelectionDrop.Text) {
			await instance.sendText(selection.text, false, true);
			return;
		}

		const range = await this.locateSelection(selection);
		if (!range) {
			return;
		}

		const path = getAgentDockTerminalPath(selection.resource, await instance.getCwdResource());
		const mention = getAgentDockSelectionMention(path, range, AgentDockDropTargetKind.Terminal);
		if (!mention) {
			this.warnCannotMention(path);
			return;
		}

		await instance.sendText(`${mention} `, false, true);
	}

	/** Inserts an @-mention of each file into the chat input, as Claude Code's own "Insert @-Mention" command does. */
	private async insertIntoClaudeCode(editor: WebviewInput, resources: readonly URI[]): Promise<void> {
		for (const resource of resources) {
			const path = this.getClaudeCodePath(resource);
			const mention = getAgentDockMention(path);
			if (!mention) {
				this.warnCannotMention(path);
				continue;
			}

			if (!await this.postMention(editor, mention, path)) {
				return;
			}
		}
	}

	/** Inserts an @-mention of the selected lines into the chat input, as Claude Code's own "Insert @-Mention" command does. */
	private async insertSelectionIntoClaudeCode(editor: WebviewInput, selection: IAgentDockSelection): Promise<void> {
		const range = await this.locateSelection(selection);
		if (!range) {
			return;
		}

		const path = this.getClaudeCodePath(selection.resource);
		const mention = getAgentDockSelectionMention(path, range, AgentDockDropTargetKind.ClaudeCode);
		if (!mention) {
			this.warnCannotMention(path);
			return;
		}

		await this.postMention(editor, mention, path);
	}

	/**
	 * The lines of the file on disk that a reference to `selection` points at, which Claude Code reads: they can differ
	 * from those of the editor, such as of the staged version of a file or of a file with unsaved changes. Nothing, with a
	 * warning, when the selected lines are not in the file on disk.
	 */
	private async locateSelection(selection: IAgentDockSelection): Promise<{ readonly startLineNumber: number; readonly endLineNumber: number } | undefined> {
		let content: string;
		try {
			content = (await this.fileService.readFile(selection.resource)).value.toString();
		} catch {
			this.notificationService.warn(localize('agentDock.selectionFileMissing', "Cannot refer to the selected lines, as {0} is not on disk.", selection.resource.fsPath));
			return undefined;
		}

		const range = locateAgentDockSelection(content, selection);
		if (!range) {
			this.notificationService.warn(localize('agentDock.selectionNotOnDisk', "Cannot refer to the selected lines, as {0} on disk does not have them, such as since it changed or they were removed.", selection.resource.fsPath));
		}

		return range;
	}

	/** The path of `resource` as Claude Code writes it in an @-mention in its chat input. */
	private getClaudeCodePath(resource: URI): string {
		const includeFolderName = this.workspaceContextService.getWorkspace().folders.length > 1;
		return getAgentDockRelativePath(resource, this.workspaceContextService.getWorkspaceFolder(resource) ?? undefined, includeFolderName);
	}

	private async postMention(editor: WebviewInput, mention: string, path: string): Promise<boolean> {
		if (await editor.webview.postMessage(createClaudeCodeInsertAtMentionMessage(mention))) {
			return true;
		}

		this.notificationService.error(localize('agentDock.mentionFailed', "Could not insert {0} into Claude Code.", path));
		return false;
	}

	private warnCannotMention(path: string): void {
		this.notificationService.warn(localize('agentDock.cannotMention', "Claude Code cannot mention {0}, as its path contains # or a double quote.", path));
	}
}
