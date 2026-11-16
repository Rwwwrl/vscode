/*---------------------------------------------------------------------------------------------
 *  Copyright (c) Microsoft Corporation. All rights reserved.
 *  Licensed under the MIT License. See License.txt in the project root for license information.
 *--------------------------------------------------------------------------------------------*/

import assert from 'assert';
import { generateKeyPairSync, sign } from 'crypto';
import { promises as fs } from 'fs';
import { tmpdir } from 'os';
import { join } from '../../../../base/common/path.js';
import { zip } from '../../../../base/node/zip.js';
import { ensureNoDisposablesAreLeakedInTestSuite } from '../../../../base/test/common/utils.js';
import { getRandomTestPath } from '../../../../base/test/node/testUtils.js';
import { NullLogService } from '../../../log/common/log.js';
import { NullTelemetryService } from '../../../telemetry/common/telemetryUtils.js';
import { OpenVsxSignatureVerificationService } from '../../node/openVsxSignatureVerificationService.js';

function createKey(): { publicKey: string; privateKey: string } {
	return generateKeyPairSync('ed25519', {
		publicKeyEncoding: { type: 'spki', format: 'pem' },
		privateKeyEncoding: { type: 'pkcs8', format: 'pem' },
	});
}

suite('OpenVsxSignatureVerificationService', () => {

	ensureNoDisposablesAreLeakedInTestSuite();

	let testDir: string;

	setup(async () => {
		testDir = getRandomTestPath(tmpdir(), 'vsuite', 'openVsxSignatureVerificationService');
		await fs.mkdir(testDir, { recursive: true });
	});

	teardown(async () => {
		await fs.rm(testDir, { recursive: true, force: true });
	});

	async function writePackage(name: string, contents: Buffer): Promise<string> {
		const path = join(testDir, `${name}.vsix`);
		await fs.writeFile(path, contents);
		return path;
	}

	async function writeSignatureArchive(name: string, files: { path: string; contents: Buffer }[]): Promise<string> {
		return zip(join(testDir, `${name}.sigzip`), files);
	}

	function openVsxArchive(name: string, signature: Buffer): Promise<string> {
		return writeSignatureArchive(name, [
			{ path: '.signature.sig', contents: signature },
			{ path: '.signature.manifest', contents: Buffer.from('{}') },
			{ path: '.signature.p7s', contents: Buffer.alloc(0) },
		]);
	}

	test('verifies the package against the trusted keys', async () => {
		const trusted = createKey();
		const untrusted = createKey();
		const service = new OpenVsxSignatureVerificationService([createKey().publicKey, trusted.publicKey], new NullLogService(), NullTelemetryService);

		const contents = Buffer.from('extension package contents');
		const vsix = await writePackage('extension', contents);
		const tampered = await writePackage('tampered', Buffer.from('extension package contents!'));

		const trustedArchive = await openVsxArchive('trusted', sign(null, contents, trusted.privateKey));
		const untrustedArchive = await openVsxArchive('untrusted', sign(null, contents, untrusted.privateKey));
		const truncatedArchive = await openVsxArchive('truncated', sign(null, contents, trusted.privateKey).subarray(1));
		const marketplaceArchive = await writeSignatureArchive('marketplace', [
			{ path: '.signature.manifest', contents: Buffer.from('{}') },
			{ path: '.signature.p7s', contents: Buffer.from('pkcs7') },
		]);

		const verify = (vsixPath: string, archive: string) => service.verify('publisher.extension', '1.0.0', vsixPath, archive);

		assert.deepStrictEqual({
			signed: await verify(vsix, trustedArchive),
			tampered: await verify(tampered, trustedArchive),
			untrustedKey: await verify(vsix, untrustedArchive),
			truncatedSignature: await verify(vsix, truncatedArchive),
			missingPackage: await verify(join(testDir, 'missing.vsix'), trustedArchive),
			// Delegated to the upstream verifier, which cannot load @vscode/vsce-sign here.
			marketplaceSignature: await verify(vsix, marketplaceArchive),
		}, {
			signed: { code: 'Success' },
			tampered: { code: 'SignatureIsNotValid' },
			untrustedKey: { code: 'SignatureIsNotValid' },
			truncatedSignature: { code: 'SignatureIsUnreadable' },
			missingPackage: { code: 'PackageIsUnreadable' },
			marketplaceSignature: undefined,
		});
	});
});
