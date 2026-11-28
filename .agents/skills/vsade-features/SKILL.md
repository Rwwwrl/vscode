---
name: vsade-features
description: "Catalog of the features the vsade fork adds on top of VS Code, with the names the owner uses for them: Agent Dock (dock, agent panel, agent tabs, Claude Code/Codex tabs, selection badge, Insert Selection), multibuffer (Zed-style search/references tab, excerpts, file headers, hidden lines), git snapshot language features (Go to Definition in git: documents), Markdown preview Copy Original Text, untracked file diff (new files open as an all-added diff, stage lines of a new file), Open VSX signature verification, and small patches (diff overview ruler width, app icon, rebrand). Use whenever the owner names one of these features or a part of one, asks to change, fix, extend or explain an existing fork feature, or refers to past fork work, before searching the code."
---

# vsade Features

The fork's own features, what the owner calls them, and where they live. Read the row that matches the name the owner used, then the feature's reference file for its parts, ids, files and limits. The reference files are a map, not the source of truth: confirm a line in the code before editing it.

All core code is under `src/vs/workbench/contrib/vsade/` (`browser/<feature>/`, `common/<feature>/`, `test/{browser,common}/<feature>/`), loaded by one import each in `browser/vsade.contribution.ts`.

| Feature | Also called | What it is | Code | Pull requests | Reference |
|---|---|---|---|---|---|
| Agent Dock | the dock, agent panel, agent tabs | An editor part in the secondary side bar that holds only terminals, Claude Code and Codex conversations, with its own tab bar; plus file drops, the selection badge and Insert Selection that send file and line references to the agents | `browser/agentDock/`, `common/agentDock/` | #2, #3, #4, #6, #11, #12 | [agent-dock.md](references/agent-dock.md) |
| Multibuffer | multibuffer search, Search in Multibuffer, references multibuffer | A Zed-style editor tab that stacks excerpts of real files from a workspace text search or Find All References, with its own find (Cmd+F) | `browser/multibuffer/`, `common/multibuffer/` | #14 | [multibuffer.md](references/multibuffer.md) |
| Git snapshot language features | go to definition in diffs, LSP in git documents | Go to Definition/References/hover in read-only `git:` documents (staged version, HEAD side of a diff), answered by the working-tree file's providers | `browser/gitSnapshotLanguageFeatures/`, `common/gitResource.ts` | #13 | [git-snapshot-language-features.md](references/git-snapshot-language-features.md) |
| Copy Original Text | Markdown preview copy, copy source | A Markdown preview context-menu command that copies the Markdown source of the selected blocks (formulas, tables) | `browser/markdownPreview/`, `extensions/markdown-language-features/` (fork files + `FORK:` hunks) | #15 | [markdown-preview-copy-original-text.md](references/markdown-preview-copy-original-text.md) |
| Webview editable focus | `vsade.webviewEditableFocus`, whichkey space in Claude/Codex | A context key that tells whether a key forwarded by a webview (Claude Code, Codex, any extension webview) was typed into a text input, so a `space` leader binding works on agent panels but not while typing | `common/webviewFocus/` + `FORK:` hunks in `contrib/webview/browser/` | #17 | [webview-editable-focus.md](references/webview-editable-focus.md) |
| Untracked file diff | new file diff, stage lines of a new file | Clicking an untracked file in Source Control opens it as an all-added diff, so Stage Selected Ranges and the gutter staging buttons work on new files | `extensions/git/src/` (`FORK:` hunks only) | #18 | [untracked-file-diff.md](references/untracked-file-diff.md) |
| Open VSX signature verification | extension signature, vsce-sign replacement | Verifies Open VSX Ed25519 signatures so gallery installs work with `extensions.verifySignature` on | `src/vs/platform/vsade/node/` | #8 | [open-vsx-signature-verification.md](references/open-vsx-signature-verification.md) |
| Small patches | diff ruler, app icon, rebrand, justfile | Narrow diff overview ruler, diff word highlight contrast, app icon, `product.json` identity, build and install recipes | various | #1, #7, #9, #10 | [small-patches.md](references/small-patches.md) |

## Keep This Skill Current

A pull request that adds a feature, renames one, or changes what the owner sees (a command, setting, menu, colour, UI part, upstream patch point) updates this skill in the same pull request: a row here for a new feature, and the feature's reference file. Name UI parts the way the owner does in conversation, so a later request that uses those words lands on the right code.
