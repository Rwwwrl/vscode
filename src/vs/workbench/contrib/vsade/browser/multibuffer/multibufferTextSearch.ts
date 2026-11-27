/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { CancellationTokenSource } from '../../../../../base/common/cancellation.js';
import { isCancellationError } from '../../../../../base/common/errors.js';
import { Disposable, toDisposable } from '../../../../../base/common/lifecycle.js';
import { IObservable, observableValue, transaction } from '../../../../../base/common/observable.js';
import { localize } from '../../../../../nls.js';
import { IConfigurationService } from '../../../../../platform/configuration/common/configuration.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { IWorkspaceContextService } from '../../../../../platform/workspace/common/workspace.js';
import { QueryBuilder } from '../../../../services/search/common/queryBuilder.js';
import { ISearchService } from '../../../../services/search/common/search.js';
import { IMultibufferTextQuery, MultibufferSettingId } from '../../common/multibuffer/multibuffer.js';
import { mapTextSearchResults } from '../../common/multibuffer/multibufferSearchResults.js';
import { MultibufferModel } from './multibufferModel.js';

/** The title of a text search multibuffer, which tells its query. */
export function getTextSearchTitle(query: IMultibufferTextQuery): string {
	return query.pattern
		? localize('multibuffer.searchTitle', "Search: {0}", query.pattern)
		: localize('multibuffer.searchTitleEmpty', "Search");
}

/**
 * Searches the workspace for a text search multibuffer and puts the results into its model, all at once when the search
 * completes. A new search cancels the one that runs.
 */
export class MultibufferTextSearch extends Disposable {

	private readonly _query = observableValue<IMultibufferTextQuery>(this, { pattern: '', isRegExp: false, isCaseSensitive: false, isWordMatch: false });
	readonly query: IObservable<IMultibufferTextQuery> = this._query;

	private running: CancellationTokenSource | undefined;
	private readonly queryBuilder: QueryBuilder;

	constructor(
		private readonly model: MultibufferModel,
		@ISearchService private readonly searchService: ISearchService,
		@IWorkspaceContextService private readonly workspaceContextService: IWorkspaceContextService,
		@IConfigurationService private readonly configurationService: IConfigurationService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();
		this.queryBuilder = instantiationService.createInstance(QueryBuilder);
		this._register(toDisposable(() => this.running?.dispose(true)));
	}

	async run(query: IMultibufferTextQuery): Promise<void> {
		this.running?.dispose(true);
		const cts = this.running = new CancellationTokenSource();
		const contextLines = this.configurationService.getValue<number>(MultibufferSettingId.ContextLines) ?? 6;
		transaction(tx => {
			this._query.set(query, tx);
			this.model.title.set(getTextSearchTitle(query), tx);
			this.model.message.set(undefined, tx);
			this.model.limitHit.set(false, tx);
			this.model.isLoading.set(!!query.pattern, tx);
			if (!query.pattern) {
				this.model.setFiles([], contextLines, tx);
			}
		});
		if (!query.pattern) {
			return;
		}

		const folders = this.workspaceContextService.getWorkspace().folders.map(folder => folder.uri);
		try {
			const textQuery = this.queryBuilder.text({
				pattern: query.pattern,
				isRegExp: query.isRegExp,
				isCaseSensitive: query.isCaseSensitive,
				isWordMatch: query.isWordMatch,
			}, folders, {
				_reason: 'vsade.multibuffer',
				maxResults: this.configurationService.getValue<number>(MultibufferSettingId.MaxResults) ?? 5000,
			});
			const complete = await this.searchService.textSearch(textQuery, cts.token);
			if (cts.token.isCancellationRequested) {
				return;
			}
			const files = mapTextSearchResults(complete.results);
			transaction(tx => {
				this.model.setFiles(files, contextLines, tx);
				this.model.limitHit.set(!!complete.limitHit, tx);
				this.model.message.set(files.length === 0
					? (folders.length === 0 ? localize('multibuffer.noFolder', "Open a folder to search in.") : localize('multibuffer.noResults', "No results found."))
					: undefined, tx);
				this.model.isLoading.set(false, tx);
			});
		} catch (error) {
			if (cts.token.isCancellationRequested || isCancellationError(error)) {
				return;
			}
			transaction(tx => {
				this.model.setFiles([], contextLines, tx);
				this.model.message.set(error instanceof Error ? error.message : String(error), tx);
				this.model.isLoading.set(false, tx);
			});
		} finally {
			if (this.running === cts) {
				this.running = undefined;
				cts.dispose();
			}
		}
	}
}
