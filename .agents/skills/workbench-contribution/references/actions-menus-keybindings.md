# Commands, menus, keybindings, context keys

Sources: `src/vs/platform/actions/common/actions.ts` (`Action2`, `registerAction2`, `MenuId`, `MenuRegistry`, `IAction2Options`), `src/vs/platform/keybinding/common/keybindingsRegistry.ts` (`KeybindingWeight`, `KeybindingsRegistry`), `src/vs/base/common/keyCodes.ts` (`KeyMod`, `KeyCode`, `KeyChord`), `src/vs/platform/contextkey/common/contextkey.ts` (`RawContextKey`, `ContextKeyExpr`, `IContextKeyService`), `src/vs/platform/action/common/actionCommonCategories.ts` (`Categories`). Model: `src/vs/workbench/contrib/meteredConnection/browser/meteredConnection.contribution.ts`. For `group`/`order` placement in any menu, follow `.github/skills/context-menus/SKILL.md`.

Snippet imports assume a file in `src/vs/workbench/contrib/vsade/browser/<feature>/` (or `common/<feature>/`): five `../` reach `src/vs`, four reach `src/vs/workbench`. Recount for any other location.

## Action2 skeleton

```ts
import { Codicon } from '../../../../../base/common/codicons.js';
import { KeyCode, KeyMod } from '../../../../../base/common/keyCodes.js';
import { localize2 } from '../../../../../nls.js';
import { Categories } from '../../../../../platform/action/common/actionCommonCategories.js';
import { Action2, MenuId, registerAction2 } from '../../../../../platform/actions/common/actions.js';
import { ContextKeyExpr } from '../../../../../platform/contextkey/common/contextkey.js';
import { ServicesAccessor } from '../../../../../platform/instantiation/common/instantiation.js';
import { KeybindingWeight } from '../../../../../platform/keybinding/common/keybindingsRegistry.js';
import { INotificationService } from '../../../../../platform/notification/common/notification.js';
import { IFooService, FooEnabledContext } from '../../common/foo/foo.js';

registerAction2(class RunFooAction extends Action2 {

	static readonly ID = 'vsade.foo.run';

	constructor() {
		super({
			id: RunFooAction.ID,
			title: localize2('runFoo', "Run Foo"),
			category: Categories.View,
			icon: Codicon.play,
			f1: true,
			precondition: FooEnabledContext,
			keybinding: {
				weight: KeybindingWeight.WorkbenchContrib,
				primary: KeyMod.CtrlCmd | KeyMod.Shift | KeyCode.KeyF,
				mac: { primary: KeyMod.WinCtrl | KeyMod.Shift | KeyCode.KeyF },
				when: ContextKeyExpr.has('config.vsade.foo.enabled'),
			},
			menu: [{
				id: MenuId.EditorTitle,
				group: 'navigation',
				order: 10,
				when: ContextKeyExpr.equals('resourceScheme', 'file'),
			}],
		});
	}

	override async run(accessor: ServicesAccessor, ...args: unknown[]): Promise<void> {
		const fooService = accessor.get(IFooService);
		const notificationService = accessor.get(INotificationService);
		// no accessor.get(...) below this line
		const result = await fooService.run();
		notificationService.info(result.message);
	}
});
```

What `registerAction2` does with the descriptor (read the function before relying on anything else):

- Registers the command in `CommandsRegistry`; throws if the `id` is already registered.
- `f1: true` adds it to `MenuId.CommandPalette` with `when: precondition`, so a false precondition hides it from the palette. `f1: true` forces `title` to be `ICommandActionTitle` (use `localize2`) and `category` to be a `Categories` key/value or `localize2`.
- Each `keybinding` gets `when = and(precondition, keybinding.when)`. Weights: `EditorCore` 0, `EditorContrib` 100, `WorkbenchContrib` 200 (use this), `BuiltinExtension` 300, `ExternalExtension` 400; higher wins.
- Each `menu` item inherits `precondition` (disables, does not hide); set `precondition: null` on the menu item to drop it. Use `when` to hide.
- `toggled: ContextKeyExpression` renders a checkmark. `icon` is required for `navigation` toolbar entries to render as an icon.
- The constructor takes no arguments; services only come from `accessor` in `run`.
- `run` receives the invocation args (an editor group context, a tree element, a URI). For editor-title/tab actions resolve them with `resolveCommandsContext` from `src/vs/workbench/browser/parts/editor/editorCommandsContext.ts` instead of reading the active editor.

Command ids: `vsade.<feature>.<action>` in this fork (upstream uses `workbench.action.<verb><Noun>`). Check uniqueness: `grep -rn "'vsade.foo.run'" src/vs`.

Chords: `primary: KeyChord(KeyMod.CtrlCmd | KeyCode.KeyK, KeyCode.KeyF)`. Platform overrides: `mac`, `win`, `linux` objects each with `primary`/`secondary`. Before choosing a binding, grep for the same `KeyMod ... | KeyCode.X` combination in `src/vs` to avoid collisions.

For editor-scoped actions, extend `EditorAction2` (`src/vs/editor/browser/editorExtensions.ts`) and implement `runEditorCommand(accessor, editor, ...args)`; it resolves the focused or active code editor and re-checks the precondition. For view-title actions, extend `ViewAction<T>` (`src/vs/workbench/browser/parts/views/viewPane.ts`) with `viewId` and implement `runInView(accessor, view)`.

## Menus

- Common ids (all `static readonly` on `MenuId`): `CommandPalette`, `EditorTitle`, `EditorTitleContext`, `EditorContext`, `ExplorerContext`, `ViewTitle`, `ViewItemContext`, `ViewContainerTitle`, `GlobalActivity`, `CommandCenter`, `TitleBar`, `MenubarViewMenu`, `MenubarHelpMenu`. Grep `src/vs/platform/actions/common/actions.ts` for others.
- A menu item for a command you do not own, or a submenu:

```ts
import { MenuId, MenuRegistry } from '../../../../../platform/actions/common/actions.js';

const FooSubmenu = MenuId.for('vsade.foo.submenu');	// MenuId.for reuses an existing id; `new MenuId(id)` throws if it exists

MenuRegistry.appendMenuItem(MenuId.EditorContext, {
	submenu: FooSubmenu,
	title: localize2('fooSubmenu', "Foo"),
	group: '1_modification',
	order: 100,
});
MenuRegistry.appendMenuItem(FooSubmenu, {
	command: { id: RunFooAction.ID, title: localize2('runFoo', "Run Foo") },
	group: 'navigation',
});
```

- View title menus filter by view id: `when: ContextKeyExpr.equals('view', MY_VIEW_ID)`.
- Render a menu in your own UI with `MenuWorkbenchToolBar` (`src/vs/platform/actions/browser/toolbar.ts`) given a `MenuId`; never build buttons by hand (`best-practices.instructions.md`).
- Registering an action only while a setting is on: prefer `precondition`/`when` with `ContextKeyExpr.has('config.<settingKey>')` over registering and disposing actions dynamically.

## Command without UI metadata

For an internal command called via `ICommandService.executeCommand` (`src/vs/platform/commands/common/commands.ts`):

```ts
CommandsRegistry.registerCommand('_vsade.foo.internal', (accessor, uri: URI) => accessor.get(IFooService).handle(uri));
```

Prefix internal ids with `_`; such ids are treated as private (for example `getAllUnboundCommands` in `src/vs/workbench/services/keybinding/browser/unboundCommands.ts` skips them).

## Context keys

Declare in `common/` so other contribs and `when` clauses can share them:

```ts
import { localize } from '../../../../../nls.js';
import { RawContextKey } from '../../../../../platform/contextkey/common/contextkey.js';

export const FooEnabledContext = new RawContextKey<boolean>('vsade.foo.enabled', false, localize('fooEnabled', "Whether Foo is enabled"));
```

Bind and set from the owning service or contribution:

```ts
private readonly fooEnabled: IContextKey<boolean>;

constructor(@IContextKeyService contextKeyService: IContextKeyService) {
	super();
	this.fooEnabled = FooEnabledContext.bindTo(contextKeyService);
}
// later: this.fooEnabled.set(true); this.fooEnabled.reset();
```

- Expressions: `ContextKeyExpr.has/equals/notEquals/regex/in/not/greater/and/or`, or on a key: `FooEnabledContext.isEqualTo(x)`, `.notEqualsTo(x)`, `.toNegated()`, `.negate()`. `ContextKeyExpr.and(...)` returns `ContextKeyExpression | undefined`.
- Settings are available as `config.<settingKey>` in expressions.
- Reuse existing keys: `src/vs/workbench/common/contextkeys.ts` (`ActiveEditorContext`, `SideBarVisibleContext`, `PanelVisibleContext`, `FocusedViewContext`, `WorkspaceFolderCountContext`, ...), `src/vs/platform/contextkey/common/contextkeys.ts` (`IsMacContext`, `IsWebContext`, `InputFocusedContext`), `src/vs/editor/common/editorContextKeys.ts` (`EditorContextKeys.editorTextFocus`, ...).
- A widget rendered several times needs a scoped service: `contextKeyService.createScoped(element)` (register the result), then bind keys on it. `ViewPane` already exposes `this.scopedContextKeyService`.
- Keys drive `when`/`precondition` only. Never branch on `getContextKeyValue(...)` in application logic.
- `bindContextKey(key, contextKeyService, reader => ...)` in `src/vs/platform/observable/common/platformObservableUtils.ts` keeps a key in sync with observables.
