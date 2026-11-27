/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { localize } from '../../../../../nls.js';
import { editorFindMatchHighlight, editorFindMatchHighlightBorder } from '../../../../../platform/theme/common/colors/editorColors.js';
import { registerColor } from '../../../../../platform/theme/common/colorUtils.js';
import { isHighContrast } from '../../../../../platform/theme/common/theme.js';
import { registerThemingParticipant } from '../../../../../platform/theme/common/themeService.js';

/**
 * The background of the matches a multibuffer shows excerpts around. It defaults to the other matches of a find, which
 * themes make light enough for the colors of the code to show through, as the search editor does.
 */
const multibufferMatchHighlightBackground = registerColor('vsade.multibuffer.matchHighlightBackground', editorFindMatchHighlight, localize('multibufferMatchHighlightBackground', "Background color of the matches in a multibuffer, such as the references or the results of a search. The color must not be opaque so as not to hide the code under it."), true);

const multibufferMatchHighlightBorder = registerColor('vsade.multibuffer.matchHighlightBorder', editorFindMatchHighlightBorder, localize('multibufferMatchHighlightBorder', "Border color of the matches in a multibuffer, such as the references or the results of a search."));

// The rules are written here rather than in CSS: CSS may only use the colors upstream registers
registerThemingParticipant((theme, collector) => {
	const background = theme.getColor(multibufferMatchHighlightBackground);
	if (background) {
		collector.addRule(`.monaco-editor .vsade-multibuffer-match { background-color: ${background}; }`);
	}
	const border = theme.getColor(multibufferMatchHighlightBorder);
	if (border) {
		collector.addRule(`.monaco-editor .vsade-multibuffer-match { border: 1px ${isHighContrast(theme.type) ? 'dotted' : 'solid'} ${border}; box-sizing: border-box; }`);
	}
});
