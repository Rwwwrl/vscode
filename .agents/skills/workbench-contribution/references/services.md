# Services

Sources: `src/vs/platform/instantiation/common/instantiation.ts` (`createDecorator`, `IInstantiationService`, `ServicesAccessor`), `src/vs/platform/instantiation/common/extensions.ts` (`registerSingleton`, `InstantiationType`), `src/vs/platform/ipc/electron-browser/services.ts` (`registerMainProcessRemoteService`, `registerSharedProcessRemoteService`), `src/vs/base/parts/ipc/common/ipc.ts` (`ProxyChannel`). DI rules: `.github/instructions/source-code-organization.instructions.md` and the "Code Quality" section of `coding-guidelines.instructions.md`.

Snippet imports assume a file in `src/vs/workbench/contrib/vsade/browser/<feature>/` (or `common/<feature>/`): five `../` reach `src/vs`, four reach `src/vs/workbench`. Recount for any other location.

## Where it lives

- Fork feature service: `contrib/vsade/common/<feature>/<feature>.ts` (decorator + interface) and `contrib/vsade/browser/<feature>/<feature>Service.ts` (impl), registered from the feature's `.contribution.ts`. Upstream model of the same split: `src/vs/workbench/contrib/git/common/gitService.ts`, `browser/gitService.ts`, `browser/git.contributions.ts`.
- Upstream core services shared by many areas live in `src/vs/workbench/services/<name>/{common,browser,electron-browser}/`; do not add fork services there.
- Replacing an upstream service's behavior: subclass it in `contrib/vsade` and `registerSingleton` the same id; it wins because the vsade aggregator is imported last (see `fork-feature`, rung d).
- Needs Node: interface in `src/vs/platform/<name>/common/`, impl in `src/vs/platform/<name>/node/` or `electron-main/`, proxied to the renderer over IPC (below). `src/vs/code` may not import `src/vs/workbench`. This needs `FORK:`-marked edits in `src/vs/code/...`, so first check whether a built-in extension can do the Node work (`fork-feature`, rung c).

## Define (common)

```ts
import { Event } from '../../../../../base/common/event.js';
import { createDecorator } from '../../../../../platform/instantiation/common/instantiation.js';

export const IFooService = createDecorator<IFooService>('vsadeFooService');

/** Tracks Foo items for the workbench. */
export interface IFooService {
	readonly _serviceBrand: undefined;

	readonly onDidChangeItems: Event<void>;
	getItems(): readonly IFooItem[];
	refresh(): Promise<void>;
}
```

The decorator string must be unique across the codebase: `grep -rn "createDecorator<.*>('vsadeFooService')" src/vs`.

## Implement (browser)

```ts
import { Emitter } from '../../../../../base/common/event.js';
import { Disposable } from '../../../../../base/common/lifecycle.js';
import { ILogService } from '../../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../../platform/storage/common/storage.js';
import { IFooItem, IFooService } from '../../common/foo/foo.js';

export class FooService extends Disposable implements IFooService {

	declare readonly _serviceBrand: undefined;

	private readonly _onDidChangeItems = this._register(new Emitter<void>());
	readonly onDidChangeItems = this._onDidChangeItems.event;

	private items: IFooItem[] = [];

	constructor(
		@IStorageService private readonly storageService: IStorageService,
		@ILogService private readonly logService: ILogService,
	) {
		super();
	}

	getItems(): readonly IFooItem[] {
		return this.items;
	}

	async refresh(): Promise<void> {
		// ...
		this._onDidChangeItems.fire();
	}
}
```

Register it next to the other registrations of the feature (`browser/<feature>/<feature>.contribution.ts`):

```ts
import { InstantiationType, registerSingleton } from '../../../../../platform/instantiation/common/extensions.js';

registerSingleton(IFooService, FooService, InstantiationType.Delayed);
```

- `Delayed` creates the instance on first use (a proxy until then). `Eager` creates it as soon as something depends on it; avoid it.
- A singleton is not created just because it is registered. Something must inject it: an action, a view, or a workbench contribution (see `workbench-contributions.md`).
- Expose changing values as `Event`s or `IObservable`s (`observables.instructions.md`), not callback parameters (`local/code-prefer-event-or-observable`, enforced so far only in migrated areas).
- Non-singleton helpers: `this.instantiationService.createInstance(FooModel, uri)`; constructor = non-service args first, then `@I...` params. Register the result if it is disposable.

## Consume

- In classes: constructor injection only, `@IFooService private readonly fooService: IFooService`.
- In `Action2.run(accessor)`, command handlers, and `ServicesAccessor` callbacks: `accessor.get(IFooService)`, all before the first `await`.
- From another contrib: import only from that contrib's `common/` file.

## Desktop vs web implementations

Same interface, one impl per platform, each registered from a file that only that platform's entry imports. Real example: `IClipboardService` (`src/vs/platform/clipboard/common/clipboardService.ts`) has `src/vs/workbench/services/clipboard/browser/clipboardService.ts` (imported by `workbench.web.main.ts`) and `src/vs/workbench/services/clipboard/electron-browser/clipboardService.ts` (imported by `workbench.desktop.main.ts`), each calling `registerSingleton(IClipboardService, ..., InstantiationType.Delayed)`.

Registration is last-wins: `src/vs/workbench/browser/workbench.ts` copies `getSingletonServiceDescriptors()` into the service collection in import order, and `workbench.desktop.main.ts` imports `workbench.common.main.js` first. So in the fork, without touching `workbench.web.main.ts`: register the browser impl from `browser/<feature>/<feature>.contribution.ts` (common aggregator) and the desktop impl from `electron-browser/<feature>/<feature>.contribution.ts` (desktop aggregator); desktop gets the desktop impl, web the browser one. Never rely on order between two files of the same entry.

The desktop renderer is sandboxed: `electron-browser` code gets DOM plus IPC, never `fs`, `child_process` or other Node modules.

## Node-backed service over IPC

Main process (Electron main) — model: encryption.

1. `src/vs/platform/encryption/common/encryptionService.ts`: `IEncryptionService` and `IEncryptionMainService` decorators/interfaces.
2. `src/vs/platform/encryption/electron-main/encryptionMainService.ts`: `EncryptionMainService implements IEncryptionMainService`.
3. `src/vs/code/electron-main/app.ts`: `services.set(IEncryptionMainService, new SyncDescriptor(EncryptionMainService))` in `initServices`, then in `initChannels`: `mainProcessElectronServer.registerChannel('encryption', ProxyChannel.fromService(accessor.get(IEncryptionMainService), disposables))`.
4. Renderer: `src/vs/workbench/services/encryption/electron-browser/encryptionService.ts`: `registerMainProcessRemoteService(IEncryptionService, 'encryption');`, imported from `workbench.desktop.main.ts`.

Shared process (utility process for heavier background work) — model: local git.

1. `src/vs/platform/git/common/localGitService.ts` (interface), `src/vs/platform/git/node/localGitService.ts` (impl).
2. `src/vs/code/electron-utility/sharedProcess/sharedProcessMain.ts`: `services.set(ILocalGitService, new SyncDescriptor(LocalGitService, undefined, false))` and `this.server.registerChannel('localGit', ProxyChannel.fromService(accessor.get(ILocalGitService), this._store))`.
3. Renderer: `src/vs/workbench/contrib/chat/electron-browser/chat.contribution.ts`: `registerSharedProcessRemoteService(ILocalGitService, 'localGit');`.

`ProxyChannel` proxies methods returning promises and `onXxx` events; arguments and results must be serializable (URIs are revived with the default marshalling).
