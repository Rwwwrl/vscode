# UI surfaces

Import paths assume a file in `src/vs/workbench/contrib/vsade/browser/<feature>/` (five `../` to `src/vs`). Before building visible UI read `.github/instructions/design-philosophy.instructions.md`, `design-tokens.instructions.md`, `css-best-practices.instructions.md`, `accessibility.instructions.md`, and the skills `.github/skills/ux-theming/SKILL.md`, `.github/skills/hover/SKILL.md`, `.github/skills/context-menus/SKILL.md`. Lists and trees: `tree-widgets.instructions.md`.

## View container + view

Model: `src/vs/workbench/contrib/agentsVoice/browser/transcriptsView/voiceEventStream.contribution.ts` and `voiceEventStreamView.ts`. APIs: `src/vs/workbench/common/views.ts` (`Extensions`, `IViewContainersRegistry`, `IViewsRegistry`, `IViewDescriptor`, `ViewContainerLocation`, `IViewDescriptorService`), `src/vs/workbench/browser/parts/views/viewPane.ts` (`ViewPane`, `ViewAction`), `src/vs/workbench/browser/parts/views/viewPaneContainer.ts` (`ViewPaneContainer`), `src/vs/workbench/services/views/common/viewsService.ts` (`IViewsService`).

Registration (in the `.contribution.ts`):

```ts
import { Codicon } from '../../../../../base/common/codicons.js';
import { localize, localize2 } from '../../../../../nls.js';
import { SyncDescriptor } from '../../../../../platform/instantiation/common/descriptors.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { registerIcon } from '../../../../../platform/theme/common/iconRegistry.js';
import { ViewPaneContainer } from '../../../../browser/parts/views/viewPaneContainer.js';
import { Extensions as ViewExtensions, IViewContainersRegistry, IViewsRegistry, ViewContainerLocation } from '../../../../common/views.js';
import { FooViewPane } from './fooView.js';

const FOO_CONTAINER_ID = 'vsade.foo.container';
const fooViewIcon = registerIcon('vsade-foo-view-icon', Codicon.list, localize('fooViewIcon', "View icon of the Foo view."));

const container = Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).registerViewContainer({
	id: FOO_CONTAINER_ID,
	title: localize2('fooContainer', "Foo"),
	icon: fooViewIcon,
	ctorDescriptor: new SyncDescriptor(ViewPaneContainer, [FOO_CONTAINER_ID, { mergeViewWithContainerWhenSingleView: true }]),
	storageId: FOO_CONTAINER_ID,
	hideIfEmpty: true,
	order: 100,
}, ViewContainerLocation.Sidebar);	// or Panel, AuxiliaryBar

Registry.as<IViewsRegistry>(ViewExtensions.ViewsRegistry).registerViews([{
	id: FooViewPane.ID,
	name: localize2('fooView', "Foo"),
	containerIcon: fooViewIcon,
	ctorDescriptor: new SyncDescriptor(FooViewPane),
	canToggleVisibility: true,
	canMoveView: true,
	openCommandActionDescriptor: { id: 'vsade.foo.focusView', title: localize2('focusFooView', "Focus Foo View") },
}], container);
```

To add a view to an existing container instead, pass `Registry.as<IViewContainersRegistry>(ViewExtensions.ViewContainersRegistry).get(id)` (Explorer: `VIEWLET_ID` in `src/vs/workbench/contrib/files/common/files.ts`).

The pane (copy the constructor list exactly; it must match `ViewPane`'s):

```ts
import { $, append } from '../../../../../base/browser/dom.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IContextKeyService } from '../../../../../platform/contextkey/common/contextkey.js';
import { IContextMenuService } from '../../../../../platform/contextview/browser/contextView.js';
import { IHoverService } from '../../../../../platform/hover/browser/hover.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IKeybindingService } from '../../../../../platform/keybinding/common/keybinding.js';
import { IOpenerService } from '../../../../../platform/opener/common/opener.js';
import { IThemeService } from '../../../../../platform/theme/common/themeService.js';
import { ViewPane } from '../../../../browser/parts/views/viewPane.js';
import { IViewletViewOptions } from '../../../../browser/parts/views/viewsViewlet.js';
import { IViewDescriptorService } from '../../../../common/views.js';
import { IFooService } from '../../common/foo/foo.js';

export class FooViewPane extends ViewPane {

	static readonly ID = 'vsade.foo.view';

	private list: HTMLElement | undefined;

	constructor(
		options: IViewletViewOptions,
		@IKeybindingService keybindingService: IKeybindingService,
		@IContextMenuService contextMenuService: IContextMenuService,
		@IConfigurationService configurationService: IConfigurationService,
		@IContextKeyService contextKeyService: IContextKeyService,
		@IViewDescriptorService viewDescriptorService: IViewDescriptorService,
		@IInstantiationService instantiationService: IInstantiationService,
		@IOpenerService openerService: IOpenerService,
		@IThemeService themeService: IThemeService,
		@IHoverService hoverService: IHoverService,
		@IFooService private readonly fooService: IFooService,
	) {
		super(options, keybindingService, contextMenuService, configurationService, contextKeyService, viewDescriptorService, instantiationService, openerService, themeService, hoverService);
		this._register(this.fooService.onDidChangeItems(() => this.render()));
	}

	protected override renderBody(container: HTMLElement): void {
		super.renderBody(container);
		this.list = append(container, $('.foo-list'));
		this.render();
	}

	protected override layoutBody(height: number, width: number): void {
		super.layoutBody(height, width);
	}

	private render(): void {
		// ...
	}
}
```

- Base fields available: `this.scopedContextKeyService`, `this.instantiationService`, `this.hoverService`, `this.isBodyVisible()`, `this.onDidChangeBodyVisibility`.
- Title-bar actions: `Action2` with `menu: { id: MenuId.ViewTitle, when: ContextKeyExpr.equals('view', FooViewPane.ID), group: 'navigation' }`, or extend `ViewAction<FooViewPane>` with `viewId` and implement `runInView`.
- Open/focus: `await viewsService.openView<FooViewPane>(FooViewPane.ID, true)`; get the live instance with `viewsService.getActiveViewWithId<FooViewPane>(id)`.
- Lists/trees: `WorkbenchList`/`WorkbenchAsyncDataTree` via `this.instantiationService.createInstance(...)` (`src/vs/platform/list/browser/listService.ts`).
- Create DOM with `$`/`h` from `src/vs/base/browser/dom.ts` (main-window realm; see `best-practices.instructions.md`, Multi-Window DOM).

## Status bar entry

Model: `src/vs/workbench/contrib/meteredConnection/browser/meteredConnectionStatus.ts`. API: `src/vs/workbench/services/statusbar/browser/statusbar.ts`.

```ts
private readonly entry = this._register(new MutableDisposable<IStatusbarEntryAccessor>());

private update(count: number): void {
	const props: IStatusbarEntry = {
		name: localize('status.foo', "Foo"),	// shown in the status bar context menu
		text: `$(list-unordered) ${count}`,	// codicons go in text, outside localize()
		ariaLabel: localize('status.foo.aria', "Foo items: {0}", count),
		tooltip: localize('status.foo.tooltip', "Show Foo items"),
		command: 'vsade.foo.show',
	};
	if (this.entry.value) {
		this.entry.value.update(props);
	} else {
		this.entry.value = this.statusbarService.addEntry(props, 'vsade.foo.status', StatusbarAlignment.RIGHT, 100);
	}
}
```

The id (second argument) must be stable; users hide entries by it. Remove with `this.entry.clear()`.

## Quick input

API: `src/vs/platform/quickinput/common/quickInput.ts` (`IQuickInputService`, `IQuickPickItem`, `IQuickPickSeparator`).

```ts
const picks: (IQuickPickItem & { value: FooMode })[] = [
	{ value: 'on', label: localize('foo.on', "On"), description: localize('foo.on.description', "Always on") },
	{ value: 'off', label: localize('foo.off', "Off") },
];
const pick = await quickInputService.pick(picks, { placeHolder: localize('foo.pickMode', "Select Foo Mode") });
if (pick) { /* pick.value */ }

const name = await quickInputService.input({ prompt: localize('foo.name', "Name"), validateInput: async v => v ? undefined : localize('foo.nameRequired', "A name is required") });
```

For dynamic or multi-step pickers use `createQuickPick<T>()` and own its lifetime:

```ts
const store = new DisposableStore();
const quickPick = store.add(quickInputService.createQuickPick<IQuickPickItem>());
quickPick.placeholder = localize('foo.search', "Search Foo");
store.add(quickPick.onDidAccept(() => { /* quickPick.selectedItems */ quickPick.hide(); }));
store.add(quickPick.onDidHide(() => store.dispose()));
quickPick.show();
```

A searchable provider for the `Ctrl+P` box with a prefix is a quick access provider (`src/vs/platform/quickinput/common/quickAccess.ts`, see `src/vs/workbench/contrib/quickaccess/browser/quickAccess.contribution.ts`).

## Notifications and dialogs

- `INotificationService` (`src/vs/platform/notification/common/notification.ts`): `info/warn/error(message)`, `prompt(Severity.Info, message, [{ label, run }], { neverShowAgain: { id: 'vsade.foo.prompt' } })`, `status(message, { hideAfter })` for transient status-bar text. `Severity` is exported from the same module.
- `IDialogService` (`src/vs/platform/dialogs/common/dialogs.ts`): `const { confirmed } = await dialogService.confirm({ message, detail, primaryButton: localize(...) })`; `prompt`, `input`, `info`, `warn`, `error` for modal cases. Modal dialogs only when the user must decide now.
- Progress: `IProgressService.withProgress({ location: ProgressLocation.Notification | Window, title }, async progress => ...)` (`src/vs/platform/progress/common/progress.ts`).

## Hovers

Never `element.title`. Inject `IHoverService` (`src/vs/platform/hover/browser/hover.ts`) and follow `.github/skills/hover/SKILL.md` for placement and grouping:

```ts
store.add(this.hoverService.setupDelayedHover(element, { content: localize('foo.hover', "Foo details"), style: HoverStyle.Pointer }));
```

`HoverStyle` is in `src/vs/base/browser/ui/hover/hover.ts`. Widgets that accept `hoverDelegate` (toolbars, buttons) take a shared `createInstantHoverDelegate()` (`src/vs/base/browser/ui/hover/hoverDelegateFactory.ts`).

## Editor contribution

Per-code-editor instance. Model: `src/vs/workbench/contrib/codeEditor/browser/largeFileOptimizations.ts`. API: `src/vs/editor/browser/editorExtensions.ts` (`registerEditorContribution`, `EditorContributionInstantiation`, `EditorAction2`).

```ts
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ICodeEditor } from '../../../../../editor/browser/editorBrowser.js';
import { EditorContributionInstantiation, registerEditorContribution } from '../../../../../editor/browser/editorExtensions.js';
import { IEditorContribution } from '../../../../../editor/common/editorCommon.js';

export class FooEditorController extends Disposable implements IEditorContribution {

	static readonly ID = 'vsade.foo.editorController';

	static get(editor: ICodeEditor): FooEditorController | null {
		return editor.getContribution<FooEditorController>(FooEditorController.ID);
	}

	constructor(
		private readonly editor: ICodeEditor,
		@IFooService private readonly fooService: IFooService,
	) {
		super();
		this._register(this.editor.onDidChangeModel(() => this.update()));
		this.update();
	}

	private update(): void {
		const model = this.editor.getModel();
		// decorations: this.editor.createDecorationsCollection(...), registered/cleared by this class
	}
}

registerEditorContribution(FooEditorController.ID, FooEditorController, EditorContributionInstantiation.AfterFirstRender);
```

- Instantiation: `Eager` (only if it participates in view state), `AfterFirstRender`, `BeforeFirstInteraction`, `Eventually`, `Lazy` (created by `getContribution`).
- The editor is the first (non-service) constructor argument. Contributions also run in diff editors, embedded editors and the SCM input; check `editor.getModel()` and guard on what you need.
- Highlights: a model decoration with `className`/`inlineClassName` plus CSS (`best-practices.instructions.md`, Editor Decorations).
- Editor-scoped commands: `EditorAction2` with `runEditorCommand(accessor, editor)` and a `precondition` such as `EditorContextKeys.editorTextFocus`.

## Opening editors

Always `IEditorService` (`src/vs/workbench/services/editor/common/editorService.ts`):

```ts
await editorService.openEditor({ resource: uri, options: { pinned: true, selection: { startLineNumber: 10, startColumn: 1 } } }, SIDE_GROUP);
```

Groups: omit or `ACTIVE_GROUP`, `SIDE_GROUP`, or an `IEditorGroup`. Diff: `openEditor({ original: { resource: a }, modified: { resource: b }, label })`. URLs and links: `IOpenerService.open(uri)` (`src/vs/platform/opener/common/opener.ts`).

## Icons, colors, CSS

- Icons: `registerIcon(id, Codicon.x, description)` (`src/vs/platform/theme/common/iconRegistry.ts`) for anything themable; `Codicon` (`src/vs/base/common/codicons.ts`) otherwise. In labels: `$(name)` syntax, never inside `localize`.
- Colors: reuse existing tokens via `var(--vscode-...)` (`design-tokens.instructions.md`). A new color needs `registerColor` (`src/vs/platform/theme/common/colorUtils.ts`) and a line in `build/lib/stylelint/vscode-known-variables.json` (an upstream hot file; avoid in the fork).
- CSS sits in `browser/<feature>/media/`, imported for side effects from the TS that renders it, class names prefixed with the feature.
