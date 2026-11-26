/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { coalesce } from '../../../../../base/common/arrays.js';
import { CancellationToken } from '../../../../../base/common/cancellation.js';
import { onUnexpectedExternalError } from '../../../../../base/common/errors.js';
import { Disposable, DisposableMap, DisposableStore, IDisposable, IReference } from '../../../../../base/common/lifecycle.js';
import { Schemas } from '../../../../../base/common/network.js';
import { URI } from '../../../../../base/common/uri.js';
import { Position } from '../../../../../editor/common/core/position.js';
import { Range } from '../../../../../editor/common/core/range.js';
import { DetailedLineRangeMapping } from '../../../../../editor/common/diff/rangeMapping.js';
import { LanguageFeatureRegistry } from '../../../../../editor/common/languageFeatureRegistry.js';
import { Definition, DefinitionProvider, DeclarationProvider, Hover, HoverProvider, ImplementationProvider, Location, LocationLink, ProviderResult, ReferenceContext, ReferenceProvider, TypeDefinitionProvider } from '../../../../../editor/common/languages.js';
import { ITextModel } from '../../../../../editor/common/model.js';
import { IEditorWorkerService } from '../../../../../editor/common/services/editorWorker.js';
import { ILanguageFeaturesService } from '../../../../../editor/common/services/languageFeatures.js';
import { IResolvedTextEditorModel, ITextModelService } from '../../../../../editor/common/services/resolverService.js';
import { getDeclarationsAtPosition, getDefinitionsAtPosition, getImplementationsAtPosition, getTypeDefinitionsAtPosition } from '../../../../../editor/contrib/gotoSymbol/browser/goToSymbol.js';
import { getHoversPromise } from '../../../../../editor/contrib/hover/browser/getHover.js';
import { IInstantiationService } from '../../../../../platform/instantiation/common/instantiation.js';
import { parseGitResource } from '../../common/gitResource.js';
import { mapSnapshotPosition } from './gitSnapshotPositionMapper.js';

/** The working-tree file of a git snapshot and the position of the requested symbol in it. */
interface IFileTarget {
	readonly model: ITextModel;
	readonly position: Position;
}

/** What is kept for one open snapshot until its model is disposed. */
class SnapshotEntry implements IDisposable {

	readonly store = new DisposableStore();
	disposed = false;

	/** The model of the working-tree file, held by a reference in {@link store}. */
	file: Promise<ITextModel | undefined> | undefined;

	/** The diff from the snapshot to the file, valid for the given model versions. */
	diff: { readonly snapshotVersion: number; readonly fileVersion: number; readonly changes: Promise<readonly DetailedLineRangeMapping[] | undefined> } | undefined;

	dispose(): void {
		this.disposed = true;
		this.store.dispose();
	}
}

/**
 * Finds, for a position in a `git:` snapshot document, the same symbol in the file on disk.
 */
export class GitSnapshotTargetResolver extends Disposable {

	private readonly entries = this._register(new DisposableMap<string, SnapshotEntry>());

	constructor(
		@ITextModelService private readonly textModelService: ITextModelService,
		@IEditorWorkerService private readonly editorWorkerService: IEditorWorkerService,
	) {
		super();
	}

	async resolve(snapshot: ITextModel, position: Position): Promise<IFileTarget | undefined> {
		const resource = parseGitResource(snapshot.uri);
		if (!resource || resource.submoduleOf !== undefined) {
			return undefined; // a submodule snapshot is a diff, not source
		}

		const entry = this.getEntry(snapshot);
		entry.file ??= this.resolveFile(entry, resource.file);
		const file = await entry.file;
		if (!file || file.isDisposed() || snapshot.isDisposed()) {
			return undefined;
		}

		const changes = await this.getChanges(entry, snapshot, file);
		if (!changes || file.isDisposed() || snapshot.isDisposed()) {
			return undefined;
		}

		const filePosition = mapSnapshotPosition(snapshot, file, position, changes);
		return filePosition && { model: file, position: filePosition };
	}

	private getEntry(snapshot: ITextModel): SnapshotEntry {
		const key = snapshot.uri.toString();
		let entry = this.entries.get(key);
		if (!entry) {
			entry = new SnapshotEntry();
			entry.store.add(snapshot.onWillDispose(() => this.entries.deleteAndDispose(key)));
			this.entries.set(key, entry);
		}
		return entry;
	}

	private async resolveFile(entry: SnapshotEntry, file: URI): Promise<ITextModel | undefined> {
		let reference: IReference<IResolvedTextEditorModel>;
		try {
			reference = await this.textModelService.createModelReference(file);
		} catch {
			entry.file = undefined; // the file is not on disk: try again on the next request
			return undefined;
		}

		if (entry.disposed) {
			reference.dispose();
			return undefined;
		}

		entry.store.add(reference);
		return reference.object.textEditorModel;
	}

	private getChanges(entry: SnapshotEntry, snapshot: ITextModel, file: ITextModel): Promise<readonly DetailedLineRangeMapping[] | undefined> {
		const snapshotVersion = snapshot.getVersionId();
		const fileVersion = file.getVersionId();
		if (entry.diff?.snapshotVersion !== snapshotVersion || entry.diff.fileVersion !== fileVersion) {
			entry.diff = { snapshotVersion, fileVersion, changes: this.computeChanges(snapshot.uri, file.uri) };
		}
		return entry.diff.changes;
	}

	private async computeChanges(snapshot: URI, file: URI): Promise<readonly DetailedLineRangeMapping[] | undefined> {
		try {
			const diff = await this.editorWorkerService.computeDiff(snapshot, file, { ignoreTrimWhitespace: false, maxComputationTimeMs: 1000, computeMoves: false }, 'advanced');
			return diff && !diff.quitEarly ? diff.changes : undefined;
		} catch (error) {
			onUnexpectedExternalError(error);
			return undefined;
		}
	}
}

/** Asks every provider, skipping the ones that fail. */
async function askAll<P, R>(providers: readonly P[], ask: (provider: P) => ProviderResult<R>): Promise<R[]> {
	const results = await Promise.all(providers.map(async provider => {
		try {
			return await ask(provider);
		} catch (error) {
			onUnexpectedExternalError(error);
			return undefined;
		}
	}));
	return coalesce(results);
}

/** The origin ranges of forwarded links are in the file on disk: leave them out, so the editor uses the word under the cursor. */
function withoutOrigin(links: LocationLink[]): LocationLink[] {
	return links.map(link => ({ ...link, originSelectionRange: undefined }));
}

function isNonEmpty(result: Definition | LocationLink[] | Location[]): boolean {
	return Array.isArray(result) ? result.length > 0 : true;
}

/**
 * Answers go to definition, find references and hover in `git:` snapshot documents (such as the
 * staged version of a file) with the providers of the file on disk, which language servers serve.
 *
 * Navigation stays silent when another provider already answers for the snapshot itself, so
 * languages whose servers accept `git:` documents get no duplicated results.
 */
export class GitSnapshotLanguageFeatures extends Disposable {

	private readonly resolver: GitSnapshotTargetResolver;

	constructor(
		@ILanguageFeaturesService languageFeaturesService: ILanguageFeaturesService,
		@IInstantiationService instantiationService: IInstantiationService,
	) {
		super();

		this.resolver = this._register(instantiationService.createInstance(GitSnapshotTargetResolver));

		const selector = { scheme: Schemas.git };

		const definitionRegistry = languageFeaturesService.definitionProvider;
		const definitionProvider: DefinitionProvider = {
			provideDefinition: (model, position, token) => this.navigate(definitionRegistry, definitionProvider, model, position, token,
				provider => provider.provideDefinition(model, position, token),
				async target => withoutOrigin(await getDefinitionsAtPosition(definitionRegistry, target.model, target.position, false, token))),
		};
		this._register(definitionRegistry.register(selector, definitionProvider));

		const declarationRegistry = languageFeaturesService.declarationProvider;
		const declarationProvider: DeclarationProvider = {
			provideDeclaration: (model, position, token) => this.navigate(declarationRegistry, declarationProvider, model, position, token,
				provider => provider.provideDeclaration(model, position, token),
				async target => withoutOrigin(await getDeclarationsAtPosition(declarationRegistry, target.model, target.position, false, token))),
		};
		this._register(declarationRegistry.register(selector, declarationProvider));

		const typeDefinitionRegistry = languageFeaturesService.typeDefinitionProvider;
		const typeDefinitionProvider: TypeDefinitionProvider = {
			provideTypeDefinition: (model, position, token) => this.navigate(typeDefinitionRegistry, typeDefinitionProvider, model, position, token,
				provider => provider.provideTypeDefinition(model, position, token),
				async target => withoutOrigin(await getTypeDefinitionsAtPosition(typeDefinitionRegistry, target.model, target.position, false, token))),
		};
		this._register(typeDefinitionRegistry.register(selector, typeDefinitionProvider));

		const implementationRegistry = languageFeaturesService.implementationProvider;
		const implementationProvider: ImplementationProvider = {
			provideImplementation: (model, position, token) => this.navigate(implementationRegistry, implementationProvider, model, position, token,
				provider => provider.provideImplementation(model, position, token),
				async target => withoutOrigin(await getImplementationsAtPosition(implementationRegistry, target.model, target.position, false, token))),
		};
		this._register(implementationRegistry.register(selector, implementationProvider));

		const referenceRegistry = languageFeaturesService.referenceProvider;
		const referenceProvider: ReferenceProvider = {
			provideReferences: (model, position, context, token) => this.navigate(referenceRegistry, referenceProvider, model, position, token,
				provider => provider.provideReferences(model, position, context, token),
				target => this.forwardReferences(referenceRegistry, target, context, token)),
		};
		this._register(referenceRegistry.register(selector, referenceProvider));

		const hoverRegistry = languageFeaturesService.hoverProvider;
		this._register(hoverRegistry.register(selector, {
			provideHover: (model, position, token) => this.hover(hoverRegistry, model, position, token),
		}));
	}

	private async navigate<P, R extends Definition | LocationLink[] | Location[]>(
		registry: LanguageFeatureRegistry<P>,
		self: P,
		snapshot: ITextModel,
		position: Position,
		token: CancellationToken,
		askOther: (provider: P) => ProviderResult<R>,
		forward: (target: IFileTarget) => Promise<R>,
	): Promise<R | undefined> {
		const others = registry.ordered(snapshot).filter(provider => provider !== self);
		const [answers, target] = await Promise.all([
			askAll(others, askOther),
			this.resolver.resolve(snapshot, position),
		]);

		if (!target || token.isCancellationRequested || answers.some(isNonEmpty)) {
			return undefined;
		}

		return forward(target);
	}

	private async forwardReferences(registry: LanguageFeatureRegistry<ReferenceProvider>, target: IFileTarget, context: ReferenceContext, token: CancellationToken): Promise<Location[]> {
		const results = await askAll(registry.ordered(target.model), provider => provider.provideReferences(target.model, target.position, context, token));
		return results.flat();
	}

	private async hover(registry: LanguageFeatureRegistry<HoverProvider>, snapshot: ITextModel, position: Position, token: CancellationToken): Promise<Hover | undefined> {
		const target = await this.resolver.resolve(snapshot, position);
		if (!target || token.isCancellationRequested) {
			return undefined;
		}

		const hovers = await getHoversPromise(registry, target.model, target.position, token);
		const contents = hovers.flatMap(hover => hover.contents);
		if (!contents.length || snapshot.isDisposed()) {
			return undefined;
		}

		// The ranges of the hovers are in the file on disk; the editor drops a hover without a range, so use the word under the cursor
		const word = snapshot.getWordAtPosition(position);
		const range = word ? new Range(position.lineNumber, word.startColumn, position.lineNumber, word.endColumn) : Range.fromPositions(position);
		return { contents, range };
	}
}
