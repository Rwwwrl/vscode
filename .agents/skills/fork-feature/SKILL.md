---
name: fork-feature
description: "Decide where and how a new feature or behavior change goes in the vsade fork of VS Code so it survives regular upstream merges. Use BEFORE writing any code whenever a feature, setting, command, UI change, or behavior change is being planned or started in this fork: it gives the placement ladder (setting -> gallery extension -> built-in extension -> fork-owned contrib -> surgical upstream patch), the isolation and FORK: marker rules for upstream-owned files, the vsade. id prefix, upstream churn hotspots to avoid, hygiene rules, and the pre-PR fork-patches check."
---

# Fork Feature (vsade)

This checkout is a personal fork: branch `sosov-fork` (default) carries the fork, `main` mirrors `upstream` (microsoft/vscode), and upstream is merged into `sosov-fork` regularly. Upstream lands roughly 100+ commits a day, so every line the fork changes in an upstream file is a future merge conflict.

## Headline rule: isolate, and mark every upstream touch

1. **Fork code lives in fork-owned files.** A file is *fork-owned* if it does not exist on `main`; everything that exists on `main` is *upstream-owned*. Put new code only under the fork-owned roots below.
2. **Every hunk in an upstream-owned file is explicitly marked** with a `FORK:` marker comment (exact syntax below). No marker, no merge.
3. **Before opening a PR, run `just fork-patches`** (`scripts/vsade/fork-patches.sh [base-ref]`, base defaults to `main`, uncommitted changes included). It lists every upstream-owned file the branch modifies and fails unless every `-U0` hunk of that file adds a line containing `FORK:`, or the file is in the ledger `scripts/vsade/fork-patches.txt`. Deleting or renaming an upstream file always needs a ledger line. Fix it, do not bypass it.
4. **The PR body lists every upstream-owned file touched, one line each with the reason**, in the `## Upstream files touched` section the `create-pr` skill prescribes. Zero is the goal; each entry must be justified by the ladder below.

Fork-owned roots (create code only here):

| Root | For |
|---|---|
| `src/vs/workbench/contrib/vsade/` | all core (renderer) fork features, see layout below |
| `src/vs/sessions/contrib/vsade/` | only if a feature must also live in the Agents window |
| `extensions/vsade-<feature>/` | fork built-in extensions ([references/built-in-extension.md](references/built-in-extension.md)) |
| `scripts/vsade/` | fork scripts (`fork-patches.sh`, `fork-patches.txt`, `sync-profile.sh`, ...) |
| `.agents/skills/<fork skill>/` | fork skills (`launch` is upstream-owned; do not edit it) |

## Conventions

**Marker.** An added line containing `FORK: <why>` directly above (touching) each contiguous change in an upstream-owned file, on its own line, so it is part of the same hunk: `// FORK: <why>` in TS/JS, `/* FORK: <why> */` in CSS, `# FORK: <why>` in YAML/shell. Never append the marker to an upstream line (that line would then conflict too), and leave no unchanged line between marker and change (it would split the hunk and the second half fails the check). `<why>` names the feature and the reason it cannot live in fork-owned code. Example: the `build/hygiene.ts` gallery check. `git grep -n 'FORK:' -- ':!.agents'` lists every patch point (`FORK:` has zero hits on `main`; `:!.agents` skips the skills' own text).

**Ledger** for upstream files that cannot hold comments: `scripts/vsade/fork-patches.txt`, one `<path><TAB><reason>` line per file (already: `product.json`). Use it for JSON (`package.json`, `build/lib/i18n.resources.json`, `build/lib/stylelint/vscode-known-variables.json`), generated files (`pnpm-lock.yaml`, `src/vs/platform/extensions/common/extensionsApiProposals.ts`), and deleted/renamed upstream files. Generated files are never hand-merged: take upstream's and regenerate.

**Id prefix `vsade.`** for everything the fork registers: commands (`vsade.<feature>.<action>`), settings (`vsade.<feature>.<name>`), context keys (`vsade.<feature>.<state>`), view/view-container ids, storage keys, MenuIds (`MenuId.for('vsade.<feature>.<menu>')`), color/icon ids. `vsade` has zero occurrences on `main`, so ids cannot collide with upstream, and the Settings editor groups them under one heading.

**Contrib layout: one parent folder, features under the layer folders.**

```
src/vs/workbench/contrib/vsade/
	browser/vsade.contribution.ts            aggregator: one import per feature
	browser/<feature>/<feature>.contribution.ts
	browser/<feature>/media/<feature>.css
	common/<feature>/...                     interfaces, ids, context keys
	electron-browser/vsade.contribution.ts   desktop-only aggregator (if needed)
	test/browser/<feature>/<name>.test.ts
```

Why not `contrib/<feature>/` per feature or `contrib/vsade/<feature>/browser/`: the `local/code-import-patterns` targets in `eslint.config.js` are `src/vs/workbench/contrib/*/{common,browser,electron-browser,...}/**`, so `contrib/vsade/browser/<feature>/` lints with no config change, while `contrib/vsade/<feature>/browser/` matches no target (lint error "Missing definition in code-import-patterns") and would force an `eslint.config.js` patch (hot file). `local/code-translation-remind` (`.eslint-plugin-local/code-translation-remind.ts`) requires every `vs/workbench/contrib/<name>` that uses `nls` to be listed in `build/lib/i18n.resources.json`; one parent folder means one entry (`vs/workbench/contrib/vsade`) for the fork's lifetime instead of one per feature. And the entry-point files get exactly one import each, forever.

The complete upstream footprint of the fork's core features is therefore: one line in `src/vs/workbench/workbench.common.main.ts`, one in `src/vs/workbench/workbench.desktop.main.ts` (only if desktop-only code exists), one entry in `build/lib/i18n.resources.json`. Place the import after the file's final `//#endregion` (upstream inserts new imports inside the regions next to related entries, so the `//#endregion` line keeps the two hunks apart and git merges them cleanly):

```ts
//#endregion

// FORK: vsade fork-owned contributions live in contrib/vsade
import './contrib/vsade/browser/vsade.contribution.js';
```

In `workbench.desktop.main.ts` the same block goes between the final `//#endregion` and `export { main } ...`. In `i18n.resources.json` (JSON: ledger line, no marker) insert the `{ "name": "vs/workbench/contrib/vsade", "project": "vscode-workbench" }` entry in the `workbench` array between the `vs/workbench/contrib/url` and `vs/workbench/contrib/watermark` entries: upstream inserts roughly alphabetically, and that neighbourhood rarely changes.

## Decision ladder: where does the change go?

Take the first rung that can do the job. Write down why each lower rung fails before moving up.

**(a) Configuration only.** User `settings.json`/`keybindings.json`/profiles/snippets/tasks, `argv.json`, or `product.json` values (see [references/product-json.md](references/product-json.md)). If the fork needs a *different default* for an upstream setting, do not edit the upstream registration: register an override with `IConfigurationRegistry.registerDefaultConfigurations` (`src/vs/platform/configuration/common/configurationRegistry.ts`) from `contrib/vsade` (rung d, zero upstream hunks), or `contributes.configurationDefaults` from a built-in extension (rung c; only for settings of machine-overridable, window, resource or language-overridable scope, per `src/vs/workbench/api/common/configurationExtensionPoint.ts`).

**(b) Existing extension.** The fork's `product.json` sets an Open VSX `extensionsGallery`, so search and install from the Extensions view; for anything not on Open VSX install a `.vsix` (`Extensions: Install from VSIX...` or `--install-extension <file>.vsix`). To ship one inside the app, add it to `product.json` `builtInExtensions` (product.json is already in the ledger; with a gallery configured `build/lib/builtInExtensions.ts` downloads from the gallery, not GitHub). Zero source changes.

**(c) New built-in extension** under `extensions/vsade-<feature>/` when the extension API can do it and it should ship with the app. The API can: commands, keybindings, menu items at the menu ids open to extensions (`src/vs/workbench/services/actions/common/menusExtensionPoint.ts`), settings, views/tree views/webviews/custom editors, status bar, decorations, language features, terminal, SCM, tasks, debug, authentication, file system providers, notebooks, chat participants and LM tools. Built-in extensions may use any proposed API (`src/vscode-dts/vscode.proposed.*.d.ts`) by listing it in `enabledApiProposals`, no `product.json` entry needed. The API cannot: touch workbench DOM, CSS, layout or parts; change how built-in views, editors, tabs or widgets render or behave; add menus where no extension menu id exists; run synchronously in the renderer (the extension host is another process); replace a core service. Cost: 3 small upstream list edits + lockfile, see the reference.

**(d) Fork-owned workbench contrib** in `src/vs/workbench/contrib/vsade/` when it needs any of the above "cannot"s: renderer DOM and native widgets, workbench/editor services, editor contributions, core MenuIds and context keys, new views with core widgets, or changed behavior of an upstream service. Change upstream behavior through seams, not edits: registries (`registerAction2`/`MenuRegistry` in `src/vs/platform/actions/common/actions.ts`, `registerWorkbenchContribution2` in `src/vs/workbench/common/contributions.ts`, `registerEditorContribution` in `src/vs/editor/browser/editorExtensions.ts`, `KeybindingsRegistry`, configuration/color/icon registries) and DI: `registerSingleton` (`src/vs/platform/instantiation/common/extensions.ts`) is last-wins (`src/vs/workbench/browser/workbench.ts` sets descriptors in import order), so a subclass of an upstream service registered from `contrib/vsade` (imported at the end of the entry file) replaces it without touching its file. Desktop-only upstream services are registered in `workbench.desktop.main.ts` after `workbench.common.main.js`, so override those from the desktop aggregator. Mechanics: the `workbench-contribution` skill (follow its patterns, but use the `contrib/vsade` layout and marker rules here).

**(e) Surgical patch to an upstream file**, only when the behavior sits inside an upstream class with no registry, event, setting or service seam. Prefer adding a *seam* (a one-line call into fork code, or a new optional hook) over inlining logic, so the hunk stays one or two lines and the logic lives in `contrib/vsade`. Rules for every hunk:
- Smallest possible hunk, each with a `FORK:` marker; append, never reorder or re-sort; no drive-by reformatting, renames, import reshuffles or whitespace fixes in upstream files.
- Gate changed upstream behavior behind a `vsade.*` setting whose "off" path is byte-for-byte upstream behavior, so a broken merge can be bisected and disabled.
- Do not add theme colors used from CSS (each needs a line in `build/lib/stylelint/vscode-known-variables.json`, a hot file); reuse existing tokens per `.github/instructions/design-tokens.instructions.md`.
- Before patching, read the area rules via the `upstream-guides` skill.

## Upstream churn hotspots (avoid, or one-line touches only)

Measured with `git log --format= --name-only -n 2000 | sort | uniq -c | sort -rn` (2000 commits = 2026-10-29..2026-11-15). Rerun it before patching anything; churn moves.
- Areas (share of all file touches): `src/vs/sessions/` 25%, `src/vs/platform/agentHost/` 16%, `src/vs/workbench/contrib/chat/` 14%, `src/vs/workbench/contrib/sessions/` 10%, plus `extensions/copilot/`. Never patch these; anything chat/agent/Agents-window related must be pure contribution (rung d) or extension (rung c). Single hottest files: `src/vs/platform/agentHost/node/copilot/copilotAgent.ts` (98), `src/vs/workbench/contrib/sessions/browser/views/sessionsList.ts` (54), `src/vs/workbench/contrib/chat/browser/chat.shared.contribution.ts` (38), `chatInputPart.ts` (33), `chatWidget.ts` (24).
- Shared lists and configs: `package.json` (55), `pnpm-lock.yaml` (51, regenerate on conflict with `pnpm install`), `.github/workflows/pr.yml` (26), `build/lib/stylelint/vscode-known-variables.json` (24), `eslint.config.js` (18), `build/npm/dirs.ts` (17), `pnpm-workspace.yaml` (15), `src/vs/sessions/sessions.common.main.ts` (13), `src/vs/workbench/workbench.common.main.ts` (9), `build/lib/i18n.resources.json` (8), `src/vs/platform/extensions/common/extensionsApiProposals.ts` (8, generated by `pnpm run gulp compile-api-proposal-names`).
- Workbench chrome: `src/vs/workbench/browser/parts/partGrid/partGrid.ts` (10), `browser/parts/editor/editorGroupView.ts` (9), `multiEditorTabsControl.ts` (8).
- Quiet (safer to seam into): `src/vs/editor/` and `src/vs/base/` (about 1% each), `src/vs/workbench/api/`, `src/vscode-dts/`, `product.json` (1).

## Hygiene applies to fork files too

`build/hygiene.ts` with the globs in `build/filters.ts` (run by `pnpm run hygiene --changed-since main`; there is no git hook and upstream CI only runs for PRs to `main`, so nothing enforces it unless you run it). Scope (`all`): root files plus `build/`, `extensions/`, `scripts/`, `src/`, `test/`, excluding `cli/`, `out*`, `node_modules`, `extensions/copilot/`; dotfiles (`.vscodeignore`) and `.agents/`, `.github/` are never checked. Checks, cascading:
- **Unicode** (`unicodeFilter`): non-ASCII outside a small allowlist fails, except in `*.json`, `*.md`, `*.d.ts`, `test/` folders, `*.test.ts`. Suppress with `// allow-any-unicode-next-line`.
- **Indentation** (`indentationFilter`): every non-blank line starts with tabs only (` *` block-comment continuation allowed). Exempt: `package.json`, `*.md`, `*.yml`/`*.yaml`, `*.svg`, images, `*.d.ts`, `build/**/*.sh`. So `package.nls.json`, `tsconfig.json`, `*.ts`, `*.mts`, `*.css` and `scripts/vsade/*.sh` must be tab-indented.
- **Copyright** (`copyrightFilter`, applied to the indentation set): the first 4 lines must equal the Microsoft MIT header literally (copy it from any `.ts` file). Exempt: `*.json`, `*.jsonc`, `*.html`, `*.md`, `*.sh`, `*.txt`, `*.toml`, `*.xml` and a few more; extensionless root files (e.g. a root `justfile`) are not exempt.
- **Formatting** (`tsFormattingFilter`): `*.ts` in `src/`, `test/`, `extensions/` (not `*.d.ts`, not `extensions/**/*.test.ts`) must match the TS formatter.
- **oxlint** (`lintFilter`) on JS/TS, warnings fail; **stylelint** on `src/**/*.css`, `extensions/**/*.css`; `product.json` fails only if its `extensionsGallery.serviceUrl` points at the Microsoft Marketplace (`visualstudio.com`; FORK-patched in `build/hygiene.ts`, upstream rejects any gallery); new `*.js`/`*.cjs`/`*.mjs` files must be listed in `.eslint-allowed-javascript-files`.

## Next

- Implementing rung (d): `workbench-contribution` skill. Rung (c): [references/built-in-extension.md](references/built-in-extension.md). `product.json`: [references/product-json.md](references/product-json.md).
- Validating: `validate-change` skill. Then `just fork-patches`, then the PR body list of upstream files.
