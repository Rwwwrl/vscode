# Workbench contributions and lifecycle

Sources: `src/vs/workbench/common/contributions.ts` (`IWorkbenchContribution`, `registerWorkbenchContribution2`, `getWorkbenchContribution`, `WorkbenchPhase`), `src/vs/workbench/services/lifecycle/common/lifecycle.ts` (`ILifecycleService`, `LifecyclePhase`). Models: `src/vs/workbench/contrib/meteredConnection/browser/meteredConnectionStatus.ts` (status bar driven by a service event), `src/vs/workbench/contrib/sash/browser/sash.ts` (settings driven), `src/vs/workbench/contrib/performance/browser/performance.contribution.ts` (`{ lazy: true }`).

Snippet imports assume a file in `src/vs/workbench/contrib/vsade/browser/<feature>/` (or `common/<feature>/`): five `../` reach `src/vs`, four reach `src/vs/workbench`. Recount for any other location.

A workbench contribution is a class the workbench instantiates once per window to wire things up at runtime: listen to services, add status bar entries, bind context keys, register providers. Static things (actions, settings, views, menus, singletons) are registered at module load in `.contribution.ts` and do not need one.

## Skeleton

```ts
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { IWorkbenchContribution } from '../../../../common/contributions.js';
import { IEditorService } from '../../../../services/editor/common/editorService.js';
import { IFooService } from '../../common/foo/foo.js';

export class FooTrackerContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'vsade.foo.tracker';

	constructor(
		@IEditorService private readonly editorService: IEditorService,
		@IFooService private readonly fooService: IFooService,
	) {
		super();
		this._register(this.editorService.onDidActiveEditorChange(() => this.update()));
		this.update();
	}

	private update(): void {
		// ...
	}
}
```

In `browser/<feature>/<feature>.contribution.ts`:

```ts
import { registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';

registerWorkbenchContribution2(FooTrackerContribution.ID, FooTrackerContribution, WorkbenchPhase.AfterRestored);
```

- The constructor takes services only (the registry instantiates it). It is disposed on shutdown when it is disposable.
- IDs: `vsade.<feature>.<name>` in this fork (upstream: `workbench.contrib.<name>`), unique (a duplicate id logs an error and the second is not addressable via `getWorkbenchContribution`).
- Per-item cleanup with a `DisposableMap`: `deleteAndDispose(key)`.
- Do not use the deprecated `Registry.as<IWorkbenchContributionsRegistry>(Extensions.Workbench).registerWorkbenchContribution(...)` even though older code (`share.contribution.ts`) still does.

## Choosing the instantiation

| Value | When it is created | Use for |
|---|---|---|
| `WorkbenchPhase.BlockStartup` | before the workbench renders; blocks it | almost never; must be cheap and needed before first paint |
| `WorkbenchPhase.BlockRestore` | services ready, before UI state restores; blocks it | must influence restore (rare) |
| `WorkbenchPhase.AfterRestored` | after views, panels, editors restored | UI wiring: status bar entries, context keys users see right away |
| `WorkbenchPhase.Eventually` | 2-5 s after restore, when idle | background work, telemetry, prompts |
| `{ lazy: true }` | first `getWorkbenchContribution<T>(id)` call | something another piece pulls on demand |
| `{ editorTypeId: SomeEditor.ID }` | when that editor pane type is first created | editor-type-specific wiring (`welcomeWalkthrough/browser/walkThrough.contribution.ts`) |

Default to `AfterRestored` for anything visible and `Eventually` for everything else. A contribution that only exists to make a lazily created singleton start is a sign the work belongs in the service or an action.

## Lifecycle hooks

```ts
constructor(@ILifecycleService private readonly lifecycleService: ILifecycleService) {
	super();
	this._register(this.lifecycleService.onWillShutdown(e => {
		e.join(this.flush(), { id: 'vsade.foo.flush', label: localize('fooFlush', "Saving Foo state") });
	}));
}

async initialize(): Promise<void> {
	await this.lifecycleService.when(LifecyclePhase.Restored);
	// ...
}
```

- `LifecyclePhase`: `Starting`, `Ready`, `Restored`, `Eventually`. `lifecycleService.phase` is the current one.
- `onBeforeShutdown(e => e.veto(promiseOrBoolean, 'vsade.foo.veto'))` can cancel shutdown (use only for unsaved user data). `onWillShutdown(e => e.join(...))` delays shutdown for cleanup. Persisting UI state belongs to `IStorageService.onWillSaveState` (see `storage-and-tests.md`).

## Reacting to state

- Subscribe through `this._register(service.onDidX(...))` or `this._register(autorun(reader => ...))` (`observables.instructions.md`).
- For per-item resources, keep them in a `DisposableMap<Key, IDisposable>` field and delete entries when the item goes away; for a single swappable resource, a `MutableDisposable` field (as `statusBarEntry` in `meteredConnectionStatus.ts`).
- Avoid driving another component through events; call its service method (`.github/copilot-instructions.md`, Code Quality).
