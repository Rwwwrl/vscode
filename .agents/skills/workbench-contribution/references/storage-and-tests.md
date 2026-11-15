# Persistence and unit tests

## IStorageService

API: `src/vs/platform/storage/common/storage.ts` (`IStorageService`, `StorageScope`, `StorageTarget`). For user-editable preferences use a setting (`configuration.md`) instead.

```ts
const FOO_STATE_KEY = 'vsade.foo.state';

interface IFooState {
	readonly collapsed: boolean;
}

export class FooStateStore extends Disposable {

	private state: IFooState;

	constructor(@IStorageService private readonly storageService: IStorageService) {
		super();
		this.state = this.storageService.getObject<IFooState>(FOO_STATE_KEY, StorageScope.PROFILE, { collapsed: false });
		this._register(this.storageService.onWillSaveState(() => this.save()));
		this._register(this.storageService.onDidChangeValue(StorageScope.PROFILE, FOO_STATE_KEY, this._store)(() => {
			this.state = this.storageService.getObject<IFooState>(FOO_STATE_KEY, StorageScope.PROFILE, { collapsed: false });
		}));
	}

	private save(): void {
		this.storageService.store(FOO_STATE_KEY, this.state, StorageScope.PROFILE, StorageTarget.USER);
	}
}
```

- Readers: `get`, `getBoolean`, `getNumber`, `getObject<T>(key, scope, fallback)`. Writers: `store(key, value, scope, target)` (objects are JSON-serialized; `undefined`/`null` removes), `remove(key, scope)`.
- `StorageScope`: `WORKSPACE` (this workspace), `PROFILE` (all workspaces of the profile; the usual choice), `APPLICATION` (all profiles), `APPLICATION_SHARED` (also shared with the Agents window).
- `StorageTarget` is required on every `store`: `USER` = user data that Settings Sync may carry across machines, `MACHINE` = machine-specific, never synced. Pick `MACHINE` for caches, paths and timestamps.
- `onDidChangeValue(scope, key, disposableStore)` takes the store the listener belongs to as its third argument (above: `this._store` of `Disposable`); it fires for changes from other windows too.
- Write when state changes, or on `onWillSaveState` (fired before shutdown and periodically) for frequently changing state. Do not write in a tight loop.
- Keys: `vsade.<feature>.<name>`. Never read or write another component's keys; add API to its service instead (`.github/copilot-instructions.md`, Code Quality).
- `Memento` (`src/vs/workbench/common/memento.ts`) is what editors and view containers use for their own state; a plain `IStorageService` key is simpler for a feature.

## Unit tests

Full guidance: `.github/instructions/writing-tests.instructions.md` (structure, snapshots, teardown) and `.github/skills/unit-tests/SKILL.md` (running). Run via `validate-change`.

- Location mirrors the code's layer: code in `contrib/vsade/browser/foo/` → test in `src/vs/workbench/contrib/vsade/test/browser/foo/fooService.test.ts`; `common/` code → `test/common/`; `electron-browser/` → `test/electron-browser/`. Upstream contribs use `contrib/<feature>/test/<layer>/`.
- Tests are discovered by the `*.test.ts` suffix; no registration needed. Run one file: `./scripts/test.sh --run src/vs/workbench/contrib/vsade/test/browser/foo/fooService.test.ts` (needs current `out/`, see the `unit-tests` skill).
- Every suite calls `ensureNoDisposablesAreLeakedInTestSuite()` (`src/vs/base/test/common/utils.ts`) and adds everything disposable to the returned store (rule `local/code-ensure-no-disposables-leak-in-test`).
- Instantiate the unit under test through `TestInstantiationService` so `@I...` decorators resolve; stub only the services it uses.
- Prefer one `assert.deepStrictEqual` over a snapshot object to many small asserts. No `any` casts, no global stubs: make the dependency injectable.

Skeleton (six `../` to `src/vs` from `contrib/vsade/test/browser/foo/`):

```ts
import assert from 'assert';
import { Emitter } from '../../../../../../base/common/event.js';
import { upcastPartial } from '../../../../../../base/test/common/mock.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../../../base/test/common/utils.js';
import { IConfigurationChangeEvent, IConfigurationService } from '../../../../../../platform/configuration/common/configuration.js';
import { TestConfigurationService } from '../../../../../../platform/configuration/test/common/testConfigurationService.js';
import { TestInstantiationService } from '../../../../../../platform/instantiation/test/common/instantiationServiceMock.js';
import { ILogService, NullLogService } from '../../../../../../platform/log/common/log.js';
import { IStorageService } from '../../../../../../platform/storage/common/storage.js';
import { TestStorageService } from '../../../../../test/common/workbenchTestServices.js';
import { FooSettingId } from '../../../common/foo/foo.js';
import { FooService } from '../../../browser/foo/fooService.js';

suite('FooService', () => {

	const store = ensureNoDisposablesAreLeakedInTestSuite();

	function createService(config: Record<string, unknown> = {}) {
		const instantiationService = store.add(new TestInstantiationService());
		const configurationService = new TestConfigurationService(config);
		instantiationService.stub(IConfigurationService, configurationService);
		instantiationService.stub(IStorageService, store.add(new TestStorageService()));
		instantiationService.stub(ILogService, new NullLogService());
		const service = store.add(instantiationService.createInstance(FooService));
		return { service, configurationService };
	}

	test('reacts to the enabled setting', async () => {
		const { service, configurationService } = createService({ [FooSettingId.Enabled]: false });
		await configurationService.setUserConfiguration(FooSettingId.Enabled, true);
		configurationService.onDidChangeConfigurationEmitter.fire(upcastPartial<IConfigurationChangeEvent>({ affectsConfiguration: key => key === FooSettingId.Enabled }));
		assert.deepStrictEqual(service.getItems().map(i => i.id), ['a', 'b']);
	});
});
```

Helpers worth knowing:

- `upcastPartial<T>(partial)` and `mock<T>()` (`src/vs/base/test/common/mock.ts`) for partial service fakes, as in `src/vs/workbench/contrib/opener/test/browser/opener.contribution.test.ts`.
- `workbenchInstantiationService(undefined, store)` (`src/vs/workbench/test/browser/workbenchTestServices.ts`) when the unit needs many real-ish workbench services (editors, files, lifecycle).
- `TestStorageService`, `TestLifecycleService`, `TestContextService` (`src/vs/workbench/test/common/workbenchTestServices.ts`); `TestConfigurationService` (`src/vs/platform/configuration/test/common/testConfigurationService.ts`); `MockContextKeyService` (`src/vs/platform/keybinding/test/common/mockKeybindingService.ts`); `TestNotificationService` (`src/vs/platform/notification/test/common/testNotificationService.ts`); `TestDialogService` (`src/vs/platform/dialogs/test/common/testDialogService.ts`).
- Editor contributions: `createCodeEditorServices(store)` and `instantiateTestCodeEditor(...)` (`src/vs/editor/test/browser/testCodeEditor.ts`), as in `src/vs/workbench/contrib/limitIndicator/test/browser/limitIndicator.test.ts`.
- Timers: `runWithFakedTimers` (`src/vs/base/test/common/virtualScheduling/runWithFakedTimers.ts`) instead of real waits.
