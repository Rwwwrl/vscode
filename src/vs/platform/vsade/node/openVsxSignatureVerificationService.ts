/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import { verify as verifySignature } from 'crypto';
import { promises as fs } from 'fs';
import { getErrorMessage } from '../../../base/common/errors.js';
import { buffer as readZipEntry } from '../../../base/node/zip.js';
import { TargetPlatform } from '../../extensions/common/extensions.js';
import { ExtensionSignatureVerificationCode } from '../../extensionManagement/common/extensionManagement.js';
import { ExtensionSignatureVerificationService, IExtensionSignatureVerificationResult, IExtensionSignatureVerificationService } from '../../extensionManagement/node/extensionSignatureVerificationService.js';
import { ILogService } from '../../log/common/log.js';
import { ITelemetryService } from '../../telemetry/common/telemetry.js';

/**
 * Public keys Open VSX signs extension packages with (Ed25519, SPKI PEM), served at
 * `https://open-vsx.org/api/-/public-key/<id>` and linked from each extension version's
 * `files.publicKey`. Pinned rather than fetched, so a compromised registry or download path
 * cannot hand out its own key. Add the new key here when Open VSX rotates it.
 */
const OPEN_VSX_PUBLIC_KEYS: readonly string[] = [
	// open-vsx.org/api/-/public-key/14ccb407-4e79-41ed-be5a-6d608325c45a
	'-----BEGIN PUBLIC KEY-----\nMCowBQYDK2VwAyEAje+vAaSS1zHV5WHCJSa5UXvxRo6+yerEU3IEmtuEuF4=\n-----END PUBLIC KEY-----\n',
];

/**
 * Entry of an Open VSX signature archive holding the raw Ed25519 signature of the whole `.vsix`.
 */
const OPEN_VSX_SIGNATURE_ENTRY = '.signature.sig';

const ED25519_SIGNATURE_LENGTH = 64;

/**
 * Verifies extensions signed by Open VSX, whose signature archive carries an Ed25519 signature of
 * the package in `.signature.sig` (and an empty `.signature.p7s`). Archives in the Visual Studio
 * Marketplace format are handed to the upstream service, which needs `@vscode/vsce-sign`.
 */
export class OpenVsxSignatureVerificationService implements IExtensionSignatureVerificationService {
	declare readonly _serviceBrand: undefined;

	private readonly marketplaceVerifier: IExtensionSignatureVerificationService;

	constructor(
		private readonly trustedPublicKeys: readonly string[],
		private readonly logService: ILogService,
		telemetryService: ITelemetryService,
	) {
		this.marketplaceVerifier = new ExtensionSignatureVerificationService(logService, telemetryService);
	}

	async verify(extensionId: string, version: string, vsixFilePath: string, signatureArchiveFilePath: string, clientTargetPlatform?: TargetPlatform): Promise<IExtensionSignatureVerificationResult | undefined> {
		let signature: Buffer;
		try {
			signature = await readZipEntry(signatureArchiveFilePath, OPEN_VSX_SIGNATURE_ENTRY);
		} catch {
			this.logService.info(`No Open VSX signature in the signature archive of ${extensionId}, verifying it as a Marketplace signature`);
			return this.marketplaceVerifier.verify(extensionId, version, vsixFilePath, signatureArchiveFilePath, clientTargetPlatform);
		}

		const code = await this.verifyPackage(vsixFilePath, signature);
		this.logService.info(`Open VSX signature verification result for ${extensionId}@${version}: ${code}`);
		return { code };
	}

	private async verifyPackage(vsixFilePath: string, signature: Buffer): Promise<ExtensionSignatureVerificationCode> {
		if (signature.length !== ED25519_SIGNATURE_LENGTH) {
			return ExtensionSignatureVerificationCode.SignatureIsUnreadable;
		}

		let extensionPackage: Buffer;
		try {
			extensionPackage = await fs.readFile(vsixFilePath);
		} catch (error) {
			this.logService.error(`Could not read ${vsixFilePath}`, getErrorMessage(error));
			return ExtensionSignatureVerificationCode.PackageIsUnreadable;
		}

		for (const publicKey of this.trustedPublicKeys) {
			try {
				if (verifySignature(null, extensionPackage, publicKey, signature)) {
					return ExtensionSignatureVerificationCode.Success;
				}
			} catch (error) {
				this.logService.error('Open VSX signature verification failed', getErrorMessage(error));
				return ExtensionSignatureVerificationCode.UnknownError;
			}
		}

		return ExtensionSignatureVerificationCode.SignatureIsNotValid;
	}
}

/**
 * {@link OpenVsxSignatureVerificationService} trusting the keys of open-vsx.org, the extension
 * gallery configured in `product.json`.
 */
export class VsadeExtensionSignatureVerificationService extends OpenVsxSignatureVerificationService {

	constructor(
		@ILogService logService: ILogService,
		@ITelemetryService telemetryService: ITelemetryService,
	) {
		super(OPEN_VSX_PUBLIC_KEYS, logService, telemetryService);
	}
}
