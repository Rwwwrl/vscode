# Open VSX Signature Verification

Installing or updating an extension from the Open VSX gallery in the packaged app works while `extensions.verifySignature` stays on. Open VSX signs each `.vsix` with Ed25519 (`.signature.sig` in the signature archive), a format `@vscode/vsce-sign` does not read, and only Microsoft's builds ship `@vscode/vsce-sign` anyway. The fork verifies the signature against Open VSX public keys pinned in the source, blocks the install on a bad, truncated or untrusted signature, and hands Marketplace-format archives to the upstream verifier.

## Triggers

Nothing to run: it applies to every gallery install or update and to `ade --install-extension`. Upstream enforces the result only in built apps (`environmentService.isBuilt`), so dev builds skip verification. No fork command or setting.

## Files

- `src/vs/platform/vsade/node/openVsxSignatureVerificationService.ts`: `OpenVsxSignatureVerificationService` and the DI subclass `VsadeExtensionSignatureVerificationService` bound to `OPEN_VSX_PUBLIC_KEYS` (one key, id `14ccb407-4e79-41ed-be5a-6d608325c45a`).
- `src/vs/platform/vsade/test/node/openVsxSignatureVerificationService.test.ts`: signed, tampered, untrusted key, truncated signature, missing package, Marketplace archive delegated.

## Upstream Patch Points

- `src/vs/code/electron-utility/sharedProcess/sharedProcessMain.ts`: two `FORK:` hunks (import, and `services.set(IExtensionSignatureVerificationService, ...)` after the upstream registration).
- `src/vs/code/node/cliProcessMain.ts`: the same two hunks for the CLI.

## Limits

- The key is pinned, not fetched: add the new key to `OPEN_VSX_PUBLIC_KEYS` when Open VSX rotates it (keys are served at `https://open-vsx.org/api/-/public-key/<id>`).
- The remote server (`src/vs/server/node/serverServices.ts`) still registers the upstream verifier.
