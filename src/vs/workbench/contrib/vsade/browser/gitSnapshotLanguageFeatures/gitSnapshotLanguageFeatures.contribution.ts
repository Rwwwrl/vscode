/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { Disposable, MutableDisposable } from '../../../../../base/common/lifecycle.js';
import { localize } from '../../../../../nls.js';
import { ConfigurationScope, Extensions as ConfigurationExtensions, IConfigurationRegistry } from '../../../../../platform/configuration/common/configurationRegistry.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { Registry } from '../../../../../platform/registry/common/platform.js';
import { IWorkbenchContribution, registerWorkbenchContribution2, WorkbenchPhase } from '../../../../common/contributions.js';
import { GitSnapshotLanguageFeaturesSettingId } from '../../common/gitSnapshotLanguageFeatures/gitSnapshotLanguageFeatures.js';
import { GitSnapshotLanguageFeatures } from './gitSnapshotLanguageFeatures.js';

Registry.as<IConfigurationRegistry>(ConfigurationExtensions.Configuration).registerConfiguration({
	id: 'vsade.gitSnapshotLanguageFeatures',
	title: localize('gitSnapshotLanguageFeaturesConfigurationTitle', "Git Snapshot Language Features"),
	type: 'object',
	properties: {
		[GitSnapshotLanguageFeaturesSettingId.Enabled]: {
			type: 'boolean',
			default: true,
			scope: ConfigurationScope.WINDOW,
			markdownDescription: localize('gitSnapshotLanguageFeatures.enabled', "Controls whether Go to Definition, Find All References and hovers work in the documents of the git extension, such as the staged version of a file, by asking the language features of the file on disk. Results reflect the file on disk, including unstaged changes."),
		},
	},
});

class GitSnapshotLanguageFeaturesContribution extends Disposable implements IWorkbenchContribution {

	static readonly ID = 'vsade.gitSnapshotLanguageFeatures';

	private readonly features = this._register(new MutableDisposable<GitSnapshotLanguageFeatures>());

	constructor(
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService private readonly instantiationService: IInstantiationService,
	) {
		super();

		this.update();
		this._register(configurationService.onDidChangeConfiguration(e => {
			if (e.affectsConfiguration(GitSnapshotLanguageFeaturesSettingId.Enabled)) {
				this.update();
			}
		}));
	}

	private update(): void {
		const enabled = this.configurationService.getValue<boolean>(GitSnapshotLanguageFeaturesSettingId.Enabled);
		if (!enabled) {
			this.features.clear();
		} else if (!this.features.value) {
			this.features.value = this.instantiationService.createInstance(GitSnapshotLanguageFeatures);
		}
	}
}

registerWorkbenchContribution2(GitSnapshotLanguageFeaturesContribution.ID, GitSnapshotLanguageFeaturesContribution, WorkbenchPhase.AfterRestored);
