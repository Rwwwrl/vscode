/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

/*
 * vsade fork: the badge next to a selection of the preview that drags a reference to the source lines of the selected
 * blocks into a terminal or Claude Code in the Agent Dock. The workbench side, and why the drag is not a native one, is in
 * `src/vs/workbench/contrib/vsade/common/agentDock/agentDockPreview.ts`; keep the messages in sync with it.
 */

import type { WebviewApi } from 'vscode-webview';

const READY_MESSAGE = 'vsade.agentDock.previewReady';
const DRAG_MESSAGE = 'vsade.agentDock.selectionDrag';
const BADGE_MESSAGE = 'vsade.agentDock.selectionBadge';

/** The source lines, from 0, that a selection of the preview spans, by the blocks it touches. */
interface SelectedBlocks {
	readonly startLine: number;
	readonly endBlockLine: number;
	readonly nextBlockLine: number | undefined;
}

function getLine(element: Element): number {
	return Number(element.getAttribute('data-line'));
}

/** The innermost block with a source line around `node`. */
function getBlock(node: Node): Element | null {
	const element = node instanceof Element ? node : node.parentElement;
	return element?.closest('[data-line]') ?? null;
}

function getSelectedBlocks(range: Range): SelectedBlocks | undefined {
	const blocks = Array.from(document.querySelectorAll('[data-line]')).filter(element => !isNaN(getLine(element)));
	const touched = blocks.filter(element => range.intersectsNode(element));
	if (!touched.length) {
		return undefined;
	}

	const startBlock = getBlock(range.startContainer);
	const startLine = startBlock ? getLine(startBlock) : Math.min(...touched.map(getLine));

	const endBlock = getBlock(range.endContainer);
	let endBlockLine: number;
	if (endBlock && range.endOffset === 0 && endBlock !== startBlock) {
		// A selection of whole blocks, such as by a triple click, ends at the start of the block after them
		const before = touched.map(getLine).filter(line => line < getLine(endBlock));
		endBlockLine = before.length ? Math.max(...before) : getLine(endBlock);
	} else {
		endBlockLine = endBlock ? getLine(endBlock) : Math.max(...touched.map(getLine));
	}

	endBlockLine = Math.max(startLine, endBlockLine);
	return { startLine, endBlockLine, nextBlockLine: getNextBlockLine(blocks, endBlockLine) };
}

function getNextBlockLine(blocks: readonly Element[], endBlockLine: number): number | undefined {
	const after = blocks.map(getLine).filter(line => line > endBlockLine);
	return after.length ? Math.min(...after) : undefined;
}

/**
 * Shows the badge next to a selection made in the preview once the mouse is up, and drags it with the pointer captured,
 * posting each step of the drag to the workbench. It shows only once the workbench says so.
 */
export function startVsadeSelectionBadge(vscode: WebviewApi<unknown>, getSource: () => string): void {
	let enabled = false;
	let selecting = false;
	let dragging: number | undefined; // the pointer of the drag
	let pendingMove: { x: number; y: number } | undefined;

	const badge = document.createElement('div');
	badge.setAttribute('aria-hidden', 'true');
	const icon = document.createElement('span');
	icon.textContent = '@';
	const label = document.createElement('span');
	badge.append(icon, label);
	Object.assign(badge.style, {
		position: 'absolute',
		zIndex: '1000',
		display: 'none',
		alignItems: 'center',
		gap: '6px',
		padding: '2px 8px 2px 6px',
		borderRadius: '4px',
		border: '1px solid var(--vscode-editorWidget-border, transparent)',
		backgroundColor: 'var(--vscode-editorWidget-background)',
		color: 'var(--vscode-editorWidget-foreground)',
		boxShadow: 'var(--vscode-shadow-md, 0 2px 8px rgba(0, 0, 0, 0.36))',
		fontFamily: 'var(--vscode-font-family)',
		fontSize: '13px',
		lineHeight: '20px',
		whiteSpace: 'nowrap',
		cursor: 'grab',
		userSelect: 'none',
		touchAction: 'none',
	});
	icon.style.opacity = '0.8';

	const hide = () => {
		badge.style.display = 'none';
	};

	const update = () => {
		const selection = document.getSelection();
		if (!enabled || selecting || dragging !== undefined || !selection || selection.isCollapsed || !selection.rangeCount) {
			if (dragging === undefined) {
				hide();
			}
			return;
		}

		const range = selection.getRangeAt(0);
		const rects = range.getClientRects();
		const last = rects[rects.length - 1];
		if (!last || !getSelectedBlocks(range)) {
			hide();
			return;
		}

		if (!badge.isConnected) {
			document.body.appendChild(badge);
		}
		badge.style.display = 'flex';

		// After the end of the selection, or below it where that is out of view
		const width = badge.offsetWidth;
		const fits = last.right + 8 + width <= document.documentElement.clientWidth;
		const left = fits ? last.right + 8 : Math.max(0, Math.min(last.left, document.documentElement.clientWidth - width));
		const top = fits ? last.top + (last.height - badge.offsetHeight) / 2 : last.bottom + 4;
		badge.style.left = `${left + window.scrollX}px`;
		badge.style.top = `${top + window.scrollY}px`;
	};

	window.addEventListener('message', event => {
		const data = event.data as { type?: unknown; enabled?: unknown; label?: unknown } | undefined;
		if (data?.type === BADGE_MESSAGE) {
			enabled = data.enabled === true;
			label.textContent = typeof data.label === 'string' ? data.label : '';
			update();
		}
	});

	document.addEventListener('pointerdown', e => {
		if (e.target !== badge && !badge.contains(e.target as Node)) {
			selecting = true;
			hide();
		}
	}, true);
	document.addEventListener('pointerup', () => {
		if (selecting) {
			selecting = false;
			update();
		}
	}, true);
	document.addEventListener('selectionchange', () => {
		if (!selecting && dragging === undefined) {
			update();
		}
	});

	//#region Drag

	const post = (message: object) => vscode.postMessage({ type: DRAG_MESSAGE, ...message });

	const flushMove = () => {
		if (pendingMove && dragging !== undefined) {
			post({ phase: 'move', ...pendingMove });
		}
		pendingMove = undefined;
	};

	const endDrag = (message: object) => {
		if (dragging === undefined) {
			return;
		}
		if (badge.hasPointerCapture(dragging)) {
			badge.releasePointerCapture(dragging);
		}
		dragging = undefined;
		pendingMove = undefined;
		badge.style.cursor = 'grab';
		post(message);
		update();
	};

	badge.addEventListener('pointerdown', e => {
		if (e.button !== 0) {
			return;
		}
		e.preventDefault(); // keeps the selection
		e.stopPropagation();

		const selection = document.getSelection();
		const blocks = selection?.rangeCount ? getSelectedBlocks(selection.getRangeAt(0)) : undefined;
		if (!blocks) {
			return;
		}

		dragging = e.pointerId;
		badge.setPointerCapture(e.pointerId);
		badge.style.cursor = 'grabbing';
		post({ phase: 'start', x: e.clientX, y: e.clientY, source: getSource(), ...blocks });
	});

	// The captured pointer keeps coming here also outside of the preview
	badge.addEventListener('pointermove', e => {
		if (e.pointerId !== dragging) {
			return;
		}
		if (!pendingMove) {
			requestAnimationFrame(flushMove);
		}
		pendingMove = { x: e.clientX, y: e.clientY };
	});
	badge.addEventListener('pointerup', e => {
		if (e.pointerId === dragging) {
			endDrag({ phase: 'end', x: e.clientX, y: e.clientY });
		}
	});
	badge.addEventListener('pointercancel', () => endDrag({ phase: 'cancel' }));
	badge.addEventListener('lostpointercapture', () => endDrag({ phase: 'cancel' }));
	window.addEventListener('keydown', e => {
		if (e.key === 'Escape') {
			endDrag({ phase: 'cancel' });
		}
	}, true);

	//#endregion

	vscode.postMessage({ type: READY_MESSAGE });
}
