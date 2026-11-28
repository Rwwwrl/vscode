# Webview Editable Focus

The context key `vsade.webviewEditableFocus` is true while the key that a webview forwards to the workbench was typed into an editable element of that webview: a `textarea`, a `select`, a text-like `input`, `contenteditable` content (including `plaintext-only`, as in the Claude Code prompt, and ProseMirror, as in Codex), or an element with an `EditContext`. It exists for leader keybindings on printable keys, such as the owner's `space` for `whichkey.show`:

```jsonc
{
	"key": "space",
	"command": "whichkey.show",
	"when": "!editorTextFocus && !terminalFocus && !inputFocus && !vsade.webviewEditableFocus"
}
```

Without it, a webview is opaque: the workbench only sees that the iframe has focus, so the binding had to exclude every agent webview by id (`activeWebviewPanelId`, `activeCustomEditorId`, `claude-vscode.sideBarActive`, ...).

## How It Works

- The webview bootstrap (`src/vs/workbench/contrib/webview/browser/pre/index.html`) adds `vsadeEditable` to every `did-keydown`/`did-keyup` message, computed by `vsadeIsEditableTarget` from the deepest target of the event (`composedPath()[0]`, so open shadow DOM counts).
- `WebviewElement.handleKeyEvent` (`src/vs/workbench/contrib/webview/browser/webviewElement.ts`) calls `updateWebviewEditableFocus` before it re-dispatches the key, so the key is current when the keybinding service resolves that very key.
- The key lives in the webview's scoped context key service, so outside a webview it is unset and `!vsade.webviewEditableFocus` holds.
- It applies to every webview (webview panels, custom editors such as Codex, webview views), not only the Agent Dock.

Known limits: a webview element in a closed shadow root reads as not editable; when the leader fires on a non-editable spot, the webview still receives the key, so `space` may also scroll the webview.

## Files

- `src/vs/workbench/contrib/vsade/common/webviewFocus/webviewFocus.ts`: `WebviewEditableFocusContext`, `updateWebviewEditableFocus`.
- `src/vs/workbench/contrib/vsade/test/browser/webviewFocus/webviewFocus.test.ts`.

## Upstream Patch Points

- `src/vs/workbench/contrib/webview/browser/pre/index.html`: the `vsadeEditable` field in `forwardKeyEvent`, the `vsadeIsEditableTarget` function after it, and the CSP `script-src` hash in the `<meta>` tag (its `FORK:` marker is the `data-vsade` attribute line). **Any change to the inline script, including an upstream merge into it, changes the hash**: recompute it (sha256, base64, of the `<script async type="module">` body with CRLF normalised) or every webview stops loading. `src/vs/workbench/contrib/webview/test/node/webviewShellMessaging.test.ts` ("matches the preload script CSP hash") catches a stale hash.
- `src/vs/workbench/contrib/webview/browser/webviewMessages.d.ts`: `vsadeEditable?` on `KeyEvent`.
- `src/vs/workbench/contrib/webview/browser/webviewElement.ts`: the import and the call in `handleKeyEvent`.
