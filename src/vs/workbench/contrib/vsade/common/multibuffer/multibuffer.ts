/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { URI } from '../../../../../base/common/uri.js';
import { IRange } from '../../../../../editor/common/core/range.js';
import { MenuId } from '../../../../../platform/actions/common/actions.js';
import { RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';

/** The editor pane of a multibuffer: excerpts of many files in one scroll. */
export const MULTIBUFFER_EDITOR_ID = 'vsade.multibuffer.editor';

/** The type of the input of a multibuffer, which is not restored after a reload. */
export const MULTIBUFFER_INPUT_TYPE_ID = 'vsade.multibuffer.input';

/** The scheme of the resource of a multibuffer input, which tells one multibuffer from another. */
export const MULTIBUFFER_SCHEME = 'vsade-multibuffer';

/**
 * Set in the scoped context of a multibuffer, and so in the context of the editors of its excerpts, such as for the menus
 * and keybindings of the commands that act on the excerpt with the cursor.
 */
export const MultibufferContext = new RawContextKey<boolean>('vsade.multibuffer', false);

/** Set in the scoped context of a multibuffer while its find widget is shown. */
export const MultibufferFindVisibleContext = new RawContextKey<boolean>('vsade.multibuffer.findVisible', false);

/** Set in the scoped context of a multibuffer while the focus is in its find widget. */
export const MultibufferFindFocusedContext = new RawContextKey<boolean>('vsade.multibuffer.findFocused', false);

/** Set in the scoped context of a multibuffer while it shows only the lines with matches, without the lines around them. */
export const MultibufferMatchLinesOnlyContext = new RawContextKey<boolean>('vsade.multibuffer.matchLinesOnly', false);

export const enum MultibufferCommandId {
	FindReferences = 'vsade.multibuffer.findReferences',
	Search = 'vsade.multibuffer.search',
	Find = 'vsade.multibuffer.find',
	FindNext = 'vsade.multibuffer.findNext',
	FindPrevious = 'vsade.multibuffer.findPrevious',
	CloseFind = 'vsade.multibuffer.closeFind',
	OpenFile = 'vsade.multibuffer.openFile',
	OpenFileToSide = 'vsade.multibuffer.openFileToSide',
	ExpandExcerptUp = 'vsade.multibuffer.expandExcerptUp',
	ExpandExcerptDown = 'vsade.multibuffer.expandExcerptDown',
	ShowMatchLinesOnly = 'vsade.multibuffer.showMatchLinesOnly',
	ShowExcerpts = 'vsade.multibuffer.showExcerpts',
}

export const enum MultibufferSettingId {
	ContextLines = 'vsade.multibuffer.contextLines',
	ExpandLines = 'vsade.multibuffer.expandLines',
	MaxResults = 'vsade.multibuffer.maxResults',
	DoubleClickBehaviour = 'vsade.multibuffer.doubleClickBehaviour',
}

/** What double-clicking a line of an excerpt does. */
export const enum MultibufferDoubleClickBehaviour {
	SelectWord = 'selectWord',
	OpenFile = 'openFile',
	OpenFileToSide = 'openFileToSide',
}

/** The menu of the header of each file of a multibuffer. Its commands get an {@link IMultibufferOpenFileContext}. */
export const MultibufferFileToolbarMenu = MenuId.for('vsade.multibuffer.fileToolbar');

/** The menu at the start of the header of a multibuffer, with the commands that act on all of its files. */
export const MultibufferHeaderToolbarMenu = MenuId.for('vsade.multibuffer.headerToolbar');

/** The matches of one file, such as the references to a symbol in it, that a multibuffer shows excerpts around. */
export interface IMultibufferFileMatches {
	readonly resource: URI;
	readonly matches: readonly IRange[];
}

/** What a command that opens the file of an excerpt gets from the header of the file. */
export interface IMultibufferOpenFileContext {
	readonly resource: URI;
	readonly selection: IRange | undefined;
}

export function isMultibufferOpenFileContext(thing: unknown): thing is IMultibufferOpenFileContext {
	return !!thing && typeof thing === 'object' && URI.isUri((thing as IMultibufferOpenFileContext).resource);
}

/** What a text search multibuffer searches the workspace for. */
export interface IMultibufferTextQuery {
	readonly pattern: string;
	readonly isRegExp: boolean;
	readonly isCaseSensitive: boolean;
	readonly isWordMatch: boolean;
}
