/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { getWindow } from '../../../../../base/browser/dom.js';
import { toDisposable } from '../../../../../base/common/lifecycle.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { ViewPane } from '../../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService, ViewContainerLocation } from '../../../../common/views.js';
import { IContentPart } from '../../../../services/editor/common/editorGroupsService.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IWorkbenchLayoutService, Parts } from '../../../../services/layout/browser/layoutService.js';
import { AGENT_DOCK_VIEW_ID } from '../../common/agentDock/agentDock.js';
import { AgentDockDropController } from './agentDockDropController.js';
import { IAgentDockService } from './agentDockService.js';
import './media/agentDock.css';

/** The class of the workbench part that the dock's editor part covers. */
const HOST_CLASS = 'vsade-agent-dock-host';

/**
 * The view of the Agent Dock. While the dock has tabs, its editor part covers the whole workbench part the view is in,
 * title and all, so that its tabs line up with those of the editor area; without tabs, the view offers to open one.
 */
export class AgentDockViewPane extends ViewPane {

	static readonly ID = AGENT_DOCK_VIEW_ID;

	private part: IContentPart | undefined;
	private partElement: HTMLElement | undefined;
	private host: HTMLElement | undefined;
	private empty = true;

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IAgentDockService private readonly agentDockService: IAgentDockService,
		@IEditorService private readonly editorService: IEditorService,
		@IWorkbenchLayoutService private readonly layoutService: IWorkbenchLayoutService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);

		// The part outlives the view: the view only shows it, on top of the workbench part it is in
		const { part, element } = this.agentDockService.getPart();
		const host = this.layoutService.getContainer(getWindow(container), this.getHostPart()) ?? container;
		host.classList.add(HOST_CLASS);
		host.appendChild(element);
		this.part = part;
		this.partElement = element;
		this.host = host;
		this._register(toDisposable(() => {
			element.remove();
			host.classList.remove(HOST_CLASS);
			part.setVisible(false);
		}));

		// Files dropped on a terminal or an agent go into it
		this._register(this.instantiationService.createInstance(AgentDockDropController, part, getWindow(container)));

		this.empty = this.isPartEmpty();
		this.updateVisibility();
		this._register(this.onDidChangeBodyVisibility(() => this.updateVisibility()));
		this._register(this.editorService.onDidEditorsChange(() => this.updateEmpty()));
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);

		this.layoutPart();
	}

	override shouldShowWelcome(): boolean {
		return this.empty;
	}

	override focus(): void {
		super.focus();

		if (this.part && !this.empty) {
			this.part.activeGroup.focus();
		}
	}

	private getHostPart(): Parts {
		switch (this.viewDescriptorService.getViewLocationById(this.id)) {
			case ViewContainerLocation.Sidebar: return Parts.SIDEBAR_PART;
			case ViewContainerLocation.Panel: return Parts.PANEL_PART;
			default: return Parts.AUXILIARYBAR_PART;
		}
	}

	private isPartEmpty(): boolean {
		return !this.part || this.part.groups.every(group => group.isEmpty);
	}

	private updateEmpty(): void {
		const empty = this.isPartEmpty();
		if (empty === this.empty) {
			return;
		}

		this.empty = empty;
		this._onDidChangeViewWelcomeState.fire();
		this.updateVisibility();
	}

	/** The part shows while the view does and has tabs; otherwise the view's own title and welcome content show. */
	private updateVisibility(): void {
		const visible = this.isBodyVisible() && !this.empty;
		this.partElement?.classList.toggle('visible', visible);
		this.part?.setVisible(visible);
		if (visible) {
			this.layoutPart();
		}
	}

	private layoutPart(): void {
		if (this.part && this.host && this.partElement?.classList.contains('visible')) {
			this.part.layout(this.host.clientWidth, this.host.clientHeight, 0, 0);
		}
	}
}
