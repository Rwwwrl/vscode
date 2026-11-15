---
name: workbench-contribution
description: "Recipe for implementing a core VS Code workbench feature in src/vs so it compiles, loads and passes lint on the first try. Use when adding or changing commands/actions (Action2), menus, keybindings, command palette entries, settings, context keys, services (createDecorator/registerSingleton), workbench contributions, views/view containers, status bar entries, quick picks, notifications/dialogs, hovers, editor contributions, or persisted state in src/vs/workbench. Covers folder layout, entry points, layering, DI, localization, disposables and the common mistakes."
---

# Workbench Contribution

How to write the code of a workbench feature. Where it goes in this fork (and whether it should be core code at all) is decided first by the `fork-feature` skill: fork features live under `src/vs/workbench/contrib/vsade/`, every id is prefixed `vsade.<feature>.`, and every touched upstream file needs a `FORK:` marker. The examples below use `foo` as the feature; prefix real ids accordingly.

Read first, because Claude Code does not auto-load them: `.github/instructions/source-code-organization.instructions.md`, `coding-guidelines.instructions.md`, `best-practices.instructions.md`, `disposable.instructions.md`, and `observables.instructions.md` when you use observables. The `upstream-guides` skill indexes the area-specific ones.

## 1. Folder layout

Upstream gives each feature its own `src/vs/workbench/contrib/<feature>/`. This fork nests features inside one fork-owned contrib, under the layer folders (the reason is in `fork-feature`):

```
src/vs/workbench/contrib/vsade/
	common/<feature>/<feature>.ts               service decorator + interface, RawContextKeys, setting ids (no DOM, no Node)
	browser/vsade.contribution.ts               aggregator: one `import './<feature>/<feature>.contribution.js';` per feature
	browser/<feature>/<feature>.contribution.ts registrations: registerSingleton, registerAction2, registerWorkbenchContribution2, settings, views
	browser/<feature>/<feature>Service.ts       implementation (DOM allowed)
	browser/<feature>/media/<feature>.css       imported as `import './media/<feature>.css';`
	electron-browser/vsade.contribution.ts      desktop-only aggregator (no Node APIs: the renderer is sandboxed)
	test/browser/<feature>/<name>.test.ts       tests mirror the layer of the code they test
```

The layer folder (`common`, `browser`, `electron-browser`, `node`) must be the first folder below the contrib name, or `local/code-import-patterns` has no matching target. `node/` code under `contrib/` is only consumed by the extension host (`src/vs/workbench/api/node`), never by the renderer; Node work for a desktop feature goes to the main or shared process behind IPC (see [references/services.md](references/services.md)).

## 2. Entry points

Only modules reachable from an entry file load; a missing import fails silently.

| File | Loaded by | Holds |
|---|---|---|
| `src/vs/workbench/workbench.common.main.ts` | desktop and web (both import it first) | `common/` + `browser/` contributions |
| `src/vs/workbench/workbench.desktop.main.ts` | Electron desktop only | `electron-browser/` contributions, desktop service impls |
| `src/vs/workbench/workbench.web.main.ts` | web only | web-only service impls |
| `src/vs/sessions/sessions.common.main.ts` | Agents window | its own list; workbench contribs do not appear there unless imported |

The fork adds one `// FORK:`-marked import of `./contrib/vsade/browser/vsade.contribution.js` after the final `//#endregion` of `workbench.common.main.ts` (and of the desktop aggregator in `workbench.desktop.main.ts` if needed). New features only add a line to the aggregator. If `src/vs/workbench/contrib/vsade/browser/vsade.contribution.ts` does not exist yet, the first feature creates it together with the entry-point import and the `build/lib/i18n.resources.json` entry, exactly as `fork-feature` describes. Imports always use relative paths with the `.js` extension.

## 3. Layering (enforced)

- Layers `base` → `platform` → `editor` → `workbench` (→ `sessions`); import only downward. `src/vs/code` (Electron main, shared process) may not import `workbench`.
- Environments: `common` → `common`; `browser` → `common`; `node` → `common`; `electron-browser` → `common` + `browser` (`codeLayers` in `eslint.config.js`, rule `local/code-layering`).
- `local/code-import-patterns` (`eslint.config.js`): `src/vs/workbench/contrib/*/~` may import `vs/base`, `vs/platform/*`, `vs/editor`, `vs/editor/contrib/*`, `vs/workbench`, `vs/workbench/services/*`, `vs/workbench/contrib/*`. `vs/workbench/services/*` and `vs/workbench/browser` must not import `contrib`. Use another contrib only through its `common/` API.
- `local/code-translation-remind`: a `vs/workbench/contrib/<name>` that imports `nls` must be listed in `build/lib/i18n.resources.json` (done once for `vs/workbench/contrib/vsade`).
- `pnpm run valid-layers-check` catches DOM/Node types in the wrong layer; `pnpm run oxlint <files>` runs the rules. The `validate-change` skill says when to run what.

## 4. Dependency injection

- `export const IFooService = createDecorator<IFooService>('vsadeFooService');` with `readonly _serviceBrand: undefined;` in the interface and `declare readonly _serviceBrand: undefined;` in the class.
- Constructor: non-service args first, then `@IService private readonly x: IService`. Every parameter property needs an access modifier. Never read a parameter property from a field initializer (`local/code-no-parameter-property-before-init`).
- `registerSingleton(IFooService, FooService, InstantiationType.Delayed)` (`src/vs/platform/instantiation/common/extensions.ts`). Registration is last-wins in import order. Use `Eager` only with a reason.
- Non-singletons: `instantiationService.createInstance(Ctor, ...nonServiceArgs)`. Never fetch services later via `invokeFunction(accessor => accessor.get(...))` inside a class.
- `Action2.run(accessor)`: get every service before the first `await` (`local/code-no-accessor-after-await`).

## 5. Localization

- `localize('key', "Message {0}", arg)` → `string`; `localize2('key', "Message")` → `ILocalizedString`, required for `Action2` `title`/`category` with `f1: true` and for view/view-container names. Both from `src/vs/nls.ts`.
- Key and message are literals; keys unique per file; user-visible text in "double quotes", all other strings in 'single quotes' (`local/code-no-unexternalized-strings`). No concatenation, no template literals, no `$(icon)` in localized text.
- Commands, buttons, menu items: Title Case. View titles: sentence case. Setting descriptions: "Controls whether ...".

## 6. Disposables

Extend `Disposable`; wrap each listener/registration in `this._register(...)` where it is created. `MutableDisposable` for one replaceable thing, a readonly `DisposableStore` for a group you `clear()`, `DisposableMap` for keyed ones. A method called repeatedly returns an `IDisposable` instead of registering on `this`. `override dispose()` calls `super.dispose()`.

## 7. Pick the pattern

| Need | Reference | Real code to copy |
|---|---|---|
| Command, palette, keybinding, menu, context key | [references/actions-menus-keybindings.md](references/actions-menus-keybindings.md) | `src/vs/workbench/contrib/meteredConnection/browser/meteredConnection.contribution.ts` |
| Setting + reacting to it | [references/configuration.md](references/configuration.md) | `src/vs/workbench/contrib/sash/browser/sash.contribution.ts`, `sash.ts` |
| Service | [references/services.md](references/services.md) | `src/vs/workbench/contrib/git/common/gitService.ts`, `browser/gitService.ts`, `browser/git.contributions.ts` |
| Desktop/web split, Node-backed service | [references/services.md](references/services.md) | `src/vs/workbench/services/clipboard/{browser,electron-browser}/clipboardService.ts`, `src/vs/platform/git/{common,node}/localGitService.ts` |
| Runtime wiring at startup | [references/workbench-contributions.md](references/workbench-contributions.md) | `src/vs/workbench/contrib/meteredConnection/browser/meteredConnectionStatus.ts` |
| View container + view | [references/ui-surfaces.md](references/ui-surfaces.md) | `src/vs/workbench/contrib/agentsVoice/browser/transcriptsView/voiceEventStream.contribution.ts` |
| Status bar, quick pick, notification, dialog, hover, open editor | [references/ui-surfaces.md](references/ui-surfaces.md) | `meteredConnectionStatus.ts`, `meteredConnection.contribution.ts` |
| Editor contribution | [references/ui-surfaces.md](references/ui-surfaces.md) | `src/vs/workbench/contrib/codeEditor/browser/largeFileOptimizations.ts` |
| Persisted state, unit tests | [references/storage-and-tests.md](references/storage-and-tests.md) | `src/vs/workbench/contrib/opener/test/browser/opener.contribution.test.ts` |

Do not copy `src/vs/workbench/contrib/share/browser/share.contribution.ts`: it uses the deprecated `registerWorkbenchContribution` registry API.

## 8. Mistakes to avoid

1. Missing aggregator/entry import (nothing registers, no error), or a desktop-only file imported from `workbench.common.main.ts` (web breaks).
2. DOM in `common/`; Node modules anywhere in the renderer; `services/` importing `contrib/`; a contrib folder without a layer folder directly below it.
3. Two `registerSingleton` calls for one id: the last import wins silently. Override only deliberately (desktop aggregator over common, or a fork subclass over an upstream service), never by accident within one entry.
4. Duplicate command id (`registerAction2` throws) or `new MenuId('x')` for an existing id (throws; use `MenuId.for('x')`).
5. `f1: true` with a plain-string title; palette or editor-title commands that read the active editor instead of their `run` args (`best-practices.instructions.md`, Editor/Session Actions).
6. Accessor used after `await`; service params before non-service params; services resolved via `IInstantiationService` outside the constructor.
7. Unregistered disposables; listeners registered on `this` from a repeatedly called method; `dispose()` without `super.dispose()`.
8. Context keys used as application state (`getContextKeyValue` + branch). Keys are for `when`/`precondition`; read state from the owning service.
9. `element.title` instead of `IHoverService`; hand-made buttons instead of `Button`/`MenuWorkbenchToolBar`; `IEditorGroupsService.activeGroup.openEditor` instead of `IEditorService.openEditor`; `===` on URIs instead of `isEqual` (`src/vs/base/common/resources.ts`); scheme strings instead of `Schemas`.
10. `WorkbenchPhase.BlockStartup`/`BlockRestore` without need. Default to `AfterRestored` (visible UI) or `Eventually`; `{ lazy: true }` when something pulls it.
11. `any`/`as any`, the `in` operator, `.then()` chains, missing copyright header, spaces instead of tabs, `export const f = () =>` at top level.
12. A setting read but never registered, or registered without reacting to `onDidChangeConfiguration`.
13. A test suite without `ensureNoDisposablesAreLeakedInTestSuite()`, or a test stubbing a global.
14. Ids without the `vsade.` prefix; editing upstream files instead of registering through a registry or DI seam (`fork-feature`).

## 9. Done when

- Code under the fork-owned contrib, one aggregator line, no unmarked upstream edits.
- Every user-visible string localized; keybindings grepped for collisions (`grep -rn "KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF" src/vs`).
- A unit test under `test/<layer>/` for non-trivial logic.
- Validated per the `validate-change` skill (`pnpm run oxlint <changed files>`, the targeted test, `pnpm run valid-layers-check` when imports cross layers), then exercised in a running build via the `launch` skill.
