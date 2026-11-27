/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * vsade fork: the preview maps a selection to the source lines of the blocks it spans by their `data-line` attribute, for
 * the Agent Dock drag badge and Copy Original Text (`preview-src/vsadeSelectionBadge.ts`). Plugins that render math,
 * such as the built-in Markdown Math or Markdown All in One, drop the attributes of their tokens, so a math block would
 * have no source line.
 */

import type MarkdownIt from 'markdown-it';

/** The rules of blocks that plugins render without their attributes: math blocks, and fenced ones such as `math`. */
const BLOCK_RULES = ['math_block', 'math_inline_block', 'math_inline_bare_block', 'fence'];

/**
 * Wraps each block that `md` renders without its source line in an element with the source attributes of its token. Run
 * it after every plugin and after the rule that sets `data-line`, so it wraps their final renderers.
 */
export function keepSourceLinesOfBlocks(md: MarkdownIt): void {
	for (const type of BLOCK_RULES) {
		const rule = md.renderer.rules[type];
		if (!rule) {
			continue;
		}

		md.renderer.rules[type] = (tokens, index, options, env, self) => {
			const html = rule(tokens, index, options, env, self);
			const token = tokens[index];
			if (token.attrGet('data-line') === null || html.includes(' data-line=')) {
				return html;
			}

			return `<div${self.renderAttrs(token)}>${html}</div>\n`;
		};
	}
}
