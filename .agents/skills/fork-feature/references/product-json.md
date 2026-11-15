# product.json in the fork

`product.json` is upstream-owned but almost never edited upstream (1 touch in the last 2000 commits), so fork values there merge cheaply. It is JSON: it cannot hold a `FORK:` marker, so it is covered by its line in the ledger `scripts/vsade/fork-patches.txt` (already present: vsade identity plus the Open VSX gallery); update that reason when the fork changes another key, and list it in the PR body. During an upstream sync keep the fork's identity fields and `extensionsGallery`, take everything else from upstream (`sync-upstream` skill).

## How it is loaded

- Type: `IProductConfiguration` in `src/vs/base/common/product.ts`; services read it via `IProductService` (`src/vs/platform/product/common/productService.ts`).
- Main process / Node: `src/bootstrap-meta.ts` requires `../product.json` when running from sources (the build inlines it otherwise).
- Renderer: `src/vs/platform/product/common/product.ts` takes it from the sandbox configuration. When `VSCODE_DEV` is set it renames: `nameShort`/`nameLong` get a ` Dev` suffix, `dataFolderName` and `serverDataFolderName` get `-dev`.
- Packaged build: `build/gulpfile.vscode.ts` copies `product.json` and stamps `commit`, `date`, `checksums`, `version`, `nlsMetadataHash`, `copilotVersions` (and `agentSdks`/`dictationRuntime` when produced). Never set those by hand.

## product.overrides.json (dev only)

- Optional, gitignored file at the repo root (`.gitignore`), exempt from the indentation check (`build/filters.ts`).
- Read only when running from sources: `src/bootstrap-meta.ts` (when `VSCODE_DEV` is set) and `src/vs/server/node/webClientServer.ts` (when `!isBuilt`). Both do `Object.assign(product, overrides)`: a **shallow** merge, so an override of `extensionsGallery` or `defaultChatAgent` replaces the whole object.
- `scripts/code.sh` and `build/lib/electronVersion.ts` read `nameLong`/`nameShort`/`applicationName` from `product.json` directly to locate `.build/electron/<nameLong>.app/Contents/MacOS/<nameShort>`; overrides do not affect that.
- Use it for per-machine experiments and secrets-free dev settings. Anything the packaged app needs must be in `product.json`, because the packaged build ignores the overrides file.

## Current fork values

`nameShort`/`nameLong` `vsade`, `applicationName` `ade`, `dataFolderName` `.vsade`, `sharedDataFolderName` `.vsade-shared`, `serverDataFolderName` `.vsade-server`, `serverApplicationName` `vsade-server`, `tunnelApplicationName` `vsade-tunnel`, `urlProtocol` `vsade`, `darwinBundleIdentifier` `dev.vsade.app`, `reportIssueUrl` on `Rwwwrl/vscode`, and an Open VSX `extensionsGallery`. From sources the app shows as `vsade Dev` with extensions in `~/.vsade-dev/extensions`. Fork code must read these through `IProductService`, never hard-code them.

## Safe to customize

| Field(s) | Consumed by | Notes |
|---|---|---|
| `nameShort`, `nameLong` | window titles, dialogs, menus (many files); `src/mainImpl.ts` and `src/vs/platform/environment/node/environmentService.ts` pass `nameShort` to `getUserDataPath`; `build/lib/electron.ts` names the app bundle and executable | Packaged user data: `~/Library/Application Support/<nameShort>` on macOS. From sources the user data dir is always `code-oss-dev` (`src/vs/platform/environment/node/userDataPath.ts`). Changing them makes `build/lib/electronVersion.ts` `shouldDownloadElectron` fetch Electron again under the new bundle name. |
| `applicationName` | CLI (`src/vs/code/node/cli.ts`), `src/bootstrap-node.ts` (portable data folder `<applicationName>-portable-data`), Linux executable name | |
| `dataFolderName`, `sharedDataFolderName` | `src/vs/platform/environment/common/environmentService.ts` (`~/<dataFolderName>/extensions`, `argv.json`, `policy.json`; shared data dir), `src/mainImpl.ts` (argv.json) | Dev uses `<dataFolderName>-dev`. The dev built-in control file stays hardcoded at `~/.vscode-oss-dev/extensions/control.json` (`src/vs/platform/extensionManagement/common/extensionsScannerService.ts`, `build/lib/builtInExtensions.ts`). |
| `urlProtocol` | `src/vs/platform/url/electron-main/electronUrlListener.ts` (`setAsDefaultProtocolClient`), `src/vs/platform/url/common/urlService.ts` | Must be unique per installed app or OS links go to the wrong one. |
| `darwinBundleIdentifier`, `darwinProfileUUID`, `darwinProfilePayloadUUID` | `src/vs/code/electron-main/main.ts`, `src/vs/code/node/cliProcessMain.ts` | Change with the name if installing beside another Code - OSS. |
| `win32*` (mutex, AppIds, reg value, dir names), `linuxDesktopName`, `linuxIconName` | installers and single-instance mutexes | Change as a set only if shipping on that OS; new GUIDs for AppIds. |
| `serverApplicationName`, `serverDataFolderName`, `tunnelApplicationName` | `src/vs/server/node/remoteExtensionHostAgentCli.ts`, remote/agent-host installers under `src/vs/platform/agentHost/node/`, `src/vs/platform/remoteTunnel/node/` | Only matters for remote/server builds. |
| `extensionsGallery` | `src/vs/platform/extensionManagement/common/extensionGalleryManifestService.ts` (requires `serviceUrl`; optional `itemUrl`, `publisherUrl`, `resourceUrlTemplate`), `src/vs/platform/extensionManagement/common/extensionGalleryService.ts` (`controlUrl`, `extensionUrlTemplate`), `src/vs/platform/windows/electron-main/windowImpl.ts`, `src/vs/server/node/webClientServer.ts`; `build/lib/builtInExtensions.ts` downloads `builtInExtensions` from it when `serviceUrl` is set (else from GitHub releases) | Absent upstream; the fork sets Open VSX (`serviceUrl`, `itemUrl`, `extensionUrlTemplate`, `resourceUrlTemplate`, `controlUrl`, `nlsBaseUrl`). Do not switch to the Microsoft Marketplace: its terms restrict it to Microsoft products, and `build/hygiene.ts` (FORK-patched) rejects a `serviceUrl` matching `visualstudio.com` (upstream rejects any gallery). |
| `extensionEnabledApiProposals` | `src/vs/workbench/services/extensions/common/extensionsProposedApi.ts` (schema in `extensionsRegistry.ts`) | `{ "<publisher.name>": ["proposal", ...] }` for non-built-in (VSIX/gallery) extensions in the packaged app. The product list *replaces* the extension's own `enabledApiProposals`. Built-in extensions and anything run from sources do not need it. |
| `builtInExtensions` | `build/lib/builtInExtensions.ts` (download to `.build/builtInExtensions` on `scripts/code.sh` prelaunch via `build/lib/preLaunch.ts`), `build/lib/extensions.ts` (packaging; a local `extensions/<name>` with the same name is skipped), dev scan in `extensionsScannerService.ts` (`scanDevSystemExtensions`) | Entry: `name` (`publisher.name`), `version`, `sha256`, `repo`, `metadata`; optional `vsix` (path relative to the repo root, for a local VSIX), `platformSpecific`. `./scripts/code.sh --builtin` toggles them per machine. With the gallery set, non-`vsix`/non-`platformSpecific` entries download from `<serviceUrl>/publishers/<publisher>/vsextensions/<name>/<version>/vspackage` (`fromMarketplace` in `build/lib/extensions.ts`) and the `sha256` is verified (`build/lib/fetch.ts`), so each entry's `version` must exist on Open VSX and its hash must match the Open VSX package, not the GitHub release. |
| `builtInExtensionsEnabledWithAutoUpdates` | extension management (`extensionsScannerService.ts`, `extensionManagementService.ts`) | Built-ins allowed to auto-update from the gallery. |
| `reportIssueUrl`, `requestFeatureUrl`, `licenseUrl`, `serverLicenseUrl`, `privacyStatementUrl`, `documentationUrl`, `releaseNotesUrl`, `keyboardShortcutsUrl{Mac,Linux,Win}` | `src/vs/platform/menubar/electron-main/menubar.ts`, `src/vs/workbench/browser/actions/helpActions.ts`, `src/vs/workbench/contrib/issue/`, `src/vs/workbench/contrib/update/browser/` | Point Help links at the fork's repo, or leave upstream's. |
| `updateUrl`, `downloadUrl` | `src/vs/platform/update/electron-main/updateService.*.ts`, `src/vs/workbench/contrib/update/browser/` | Absent upstream: no update checks. Leave absent unless the fork runs an update server. |
| `linkProtectionTrustedDomains` | `src/vs/workbench/contrib/url/browser/trustedDomains.ts` | Domains that open without the link-protection prompt. |

## Telemetry-related: keep absent

`enableTelemetry` (`supportsTelemetry` in `src/vs/platform/telemetry/common/telemetryUtils.ts`), `aiConfig.ariaKey` (`isLoggingOnly`, same file; appenders in `src/vs/code/electron-utility/sharedProcess/sharedProcessMain.ts`), `enabledTelemetryLevels` (`telemetryService.ts`, `mainThreadTelemetry.ts`), `tasConfig` (`src/vs/workbench/services/assignment/common/assignmentService.ts`), `showTelemetryOptOut`, `crashReporter` and `appCenter` (`src/mainImpl.ts`). Upstream OSS defines none of them, so a packaged build sends nothing and a dev build only logs telemetry locally. Adding them would send data to whatever endpoint is configured.

## Leave alone

- `quality`: absent in OSS; read in ~90 files (e.g. proposed-API rules for extension development in `extensionsProposedApi.ts`). Setting it changes behavior widely.
- `defaultChatAgent`, `trustedExtensionAuthAccess`, `sessionsWindowAllowedExtensions`, `onboarding*`, `webviewContentExternalBaseUrlTemplate`, `voiceWsUrl`: Copilot, onboarding and webview wiring that upstream maintains; changing them breaks chat, sign-in or webviews in non-obvious ways.
- Build-stamped fields listed above (`commit`, `date`, `version`, `checksums`, `nlsMetadataHash`, `copilotVersions`, `agentSdks`, `dictationRuntime`).
