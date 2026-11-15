# Settings

Sources: `src/vs/platform/configuration/common/configurationRegistry.ts` (`IConfigurationRegistry`, `Extensions`, `ConfigurationScope`, `IConfigurationNode`, `IConfigurationPropertySchema`), `src/vs/platform/configuration/common/configuration.ts` (`IConfigurationService`, `ConfigurationTarget`), `src/vs/workbench/common/configuration.ts` (shared section nodes), `src/vs/platform/observable/common/platformObservableUtils.ts` (`observableConfigValue`). Model: `src/vs/workbench/contrib/sash/browser/sash.contribution.ts` + `sash.ts`. Policy-backed settings: `.github/skills/policy-and-managed-settings/SKILL.md`.

Snippet imports assume a file in `src/vs/workbench/contrib/vsade/browser/<feature>/` (or `common/<feature>/`): five `../` reach `src/vs`, four reach `src/vs/workbench`. Recount for any other location.

## Register

Put setting ids in `common/<feature>/<feature>.ts`:

```ts
export const enum FooSettingId {
	Enabled = 'vsade.foo.enabled',
	Mode = 'vsade.foo.mode',
}
```

Register in `browser/<feature>/<feature>.contribution.ts`:

```ts
import { localize } from '../../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { FooSettingId } from '../../common/foo/foo.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'vsade',	// every fork feature uses this id and title, so the Settings editor merges them under one heading
	order: 100,
	title: localize('vsadeConfigurationTitle', "Vsade"),
	type: 'object',
	properties: {
		[FooSettingId.Enabled]: {
			type: 'boolean',
			default: true,
			description: localize('foo.enabled', "Controls whether Foo is enabled."),
		},
		[FooSettingId.Mode]: {
			type: 'string',
			enum: ['auto', 'on', 'off'],
			enumDescriptions: [
				localize('foo.mode.auto', "Detect automatically."),
				localize('foo.mode.on', "Always on."),
				localize('foo.mode.off', "Always off."),
			],
			default: 'auto',
			scope: ConfigurationScope.WINDOW,
			markdownDescription: localize('foo.mode', "Controls the Foo mode. Only applies when {0} is enabled.", '`#vsade.foo.enabled#`'),
		},
	}
});
```

- Upstream features spread a shared section node instead (`...workbenchConfigurationNodeBase`, as `sash.contribution.ts` does); the nodes live in `src/vs/workbench/common/configuration.ts`: `workbenchConfigurationNodeBase`, `applicationConfigurationNodeBase`, `windowConfigurationNodeBase`, `securityConfigurationNodeBase`, `problemsConfigurationNodeBase`.
- Changing the default of an upstream setting: `registerDefaultConfigurations` on the same registry, never an edit of the upstream registration (see `fork-feature`).
- `scope` defaults to `ConfigurationScope.WINDOW`. Others: `APPLICATION` (default profile user settings only), `MACHINE`, `APPLICATION_MACHINE`, `RESOURCE` (per folder), `LANGUAGE_OVERRIDABLE`, `MACHINE_OVERRIDABLE`.
- Useful schema fields: `markdownDescription` (link other settings as `` `#other.setting#` `` passed as a `{0}` arg), `enum` + `enumDescriptions`, `minimum`/`maximum`, `tags: ['experimental']`, `deprecationMessage`/`markdownDeprecationMessage`, `restricted`, `order`, `ignoreSync`.
- Keys are `vsade.<feature>.<name>`. Check uniqueness: `grep -rn "'vsade.foo.enabled'" src/vs`.
- Description style: sentence, starts with "Controls ...", ends with a period.
- Migrating a renamed key: `Extensions.ConfigurationMigration` in `src/vs/workbench/common/configuration.ts`.

## Read and react

```ts
export class FooController extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'vsade.foo.controller';

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
	) {
		super();
		this.apply();
		this._register(this.configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(FooSettingId.Enabled)) {
				this.apply();
			}
		}));
	}

	private apply(): void {
		const enabled = this.configurationService.getValue<boolean>(FooSettingId.Enabled);
		// ...
	}
}
```

Observable form (see `observables.instructions.md`):

```ts
private readonly enabled: IObservable<boolean>;

constructor(@IConfigurationService configurationService: IConfigurationService) {
	super();
	this.enabled = observableConfigValue<boolean>(FooSettingId.Enabled, true, configurationService);
	this._register(autorun(reader => {
		if (this.enabled.read(reader)) {
			// ...
		}
	}));
}
```

Never read a constructor parameter property from a field initializer (`local/code-no-parameter-property-before-init`): initialize such fields in the constructor body.

- Resource-scoped values: `getValue<T>(key, { resource })`, or `ITextResourceConfigurationService` for editor-language-aware lookups.
- Write: `await configurationService.updateValue(key, value)` writes where the value is currently defined (falling back to user settings; see `deriveConfigurationTargets` in `src/vs/workbench/services/configuration/browser/configurationService.ts`); pass a `ConfigurationTarget` to force one.
- Use settings for user preferences. Use `IStorageService` for UI state the user never edits (see `storage-and-tests.md`).
- In `when` clauses a setting is `config.<key>`: `ContextKeyExpr.has('config.foo.enabled')`.
