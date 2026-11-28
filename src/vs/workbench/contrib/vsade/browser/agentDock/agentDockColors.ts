/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Codicon } from '../../../../../base/common/codicons.js';
import { localize } from '../../../../../nls.js';
import { registerColor } from '../../../../../platform/theme/common/colorUtils.js';
import { registerThemingParticipant } from '../../../../../platform/theme/common/themeService.js';
import { AGENT_DOCK_HOST_CLASS } from './agentDockView.js';

/**
 * The color of the New Claude Code buttons of the dock, the orange of the Claude Code logo, so that they read as the
 * extension's own button, which they stand in for.
 */
const agentDockClaudeCodeIconForeground = registerColor('vsade.agentDock.claudeCodeIconForeground', { dark: '#D97757', light: '#D97757', hcDark: null, hcLight: null }, localize('agentDockClaudeCodeIconForeground', "Color of the New Claude Code buttons of the Agent Dock."));

// The rule is written here rather than in CSS: CSS may only use the colors upstream registers
registerThemingParticipant((theme, collector) => {
	const color = theme.getColor(agentDockClaudeCodeIconForeground);
	if (color) {
		collector.addRule(`.monaco-workbench .part.${AGENT_DOCK_HOST_CLASS} .action-label.codicon-${Codicon.claude.id} { color: ${color}; }`);
	}
});
