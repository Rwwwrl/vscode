---
name: validate-change
description: "Validation ladder for changes in this VS Code checkout: targeted lint, hygiene, unit tests, type checks, layering, extension/integration tests, then a manual run. Use after implementing or modifying code here and before declaring the work done, committing, or opening a PR. Gives the exact command for each rung, when it is warranted, and a table of common failure signatures."
---

# Validate a Change

Climb the ladder from the cheapest rung and stop once the change is covered. The "Validating TypeScript changes" section of `.github/copilot-instructions.md` (loaded as CLAUDE.md) still governs: no completion-ritual builds or broad type checks, reuse validation whose inputs have not changed, batch test selectors into one invocation, never install dependencies with npm/yarn.

Claude Code runs without the VS Code task tools, so run repository commands directly. If a watcher is already running (`pnpm run watchd`, `pnpm run watch-client-transpiled`, or a `VS Code - Build` task in an open editor), its `out/` is current: do not start another build.

## 0. Scope the change

```bash
git status --short
git diff --name-only "$(git merge-base origin/main HEAD)"   # plus untracked files from git status
```

Every later rung takes this file list. Before writing tests or touching an area, check `upstream-guides` for area-specific rules.

## 1. Lint (seconds)

```bash
pnpm run oxlint <file|folder> [...]          # e.g. pnpm run oxlint src/vs/workbench/contrib/foo
pnpm run stylelint <file.css|folder>         # CSS only
```

- oxlint is the linter: it runs the rules of `eslint.config.js` (converted by `oxlint.config.ts`), including the local rules in `.eslint-plugin-local/` (import layering `code-layering` and `code-import-patterns`, unexternalized strings, leaked-disposable suites, `.only` in tests, `any` casts, and so on). ESLint itself is not installed; do not run `npx eslint`.
- `pnpm run oxlint --changed-since <ref>` lints only files changed between `<ref>` and `HEAD` (committed changes, not the working tree). With no arguments it lints the whole repository; avoid that.
- stylelint also checks design-token use; every `var(--vscode-*)` must exist in `build/lib/stylelint/vscode-known-variables.json`.

## 2. Hygiene, the pre-commit check (seconds)

```bash
pnpm run precommit <file> [...]   # working-tree versions of the given files
pnpm run precommit                # staged (index) versions, exactly what the hook checks
```

`pnpm run precommit` is `node build/hygiene.ts`. It enforces, per the globs in `build/filters.ts`:

- the exact 4-line Microsoft copyright header (copy it from any `.ts` file) on code files; not required for `.json`, `.md`, `.html`, `.sh`, `.txt`, `.bat`, `.toml`, images, and similar
- tab indentation (no space-indented lines)
- no unexpected Unicode; suppress a deliberate one with `// allow-any-unicode-next-line`
- TypeScript formatting (Format Document output) for `src/**`, `test/**`, `extensions/**` `.ts` except `extensions/copilot/**`, `.d.ts` and fixtures
- oxlint on lintable files and stylelint on CSS
- with no arguments, also: no new `.js/.cjs/.mjs` outside `.eslint-allowed-javascript-files`, and the `extensions/copilot` engines version when `package.json` or `extensions/copilot/**` is staged

Do not run `pnpm run hygiene` (full-repository gulp task).

No git hook is installed in this checkout: `pnpm-workspace.yaml` sets `husky: false` under `allowBuilds`, so husky never writes `.git/hooks/pre-commit`. Run `pnpm run precommit` before committing. Install a hook only if the owner asks:

```bash
hook="$(git rev-parse --git-path hooks)/pre-commit"; printf '#!/bin/sh\nexec pnpm run precommit\n' > "$hook" && chmod +x "$hook"
```

Never commit with `--no-verify` (`.github/instructions/committing.instructions.md`).

## 3. Targeted unit tests

Tests run against compiled JavaScript in `out/` (`--build` uses `out-build/`), not against `src/`. Refresh client output first unless a watcher keeps it current:

```bash
pnpm run build-fast --client-only    # cold or incremental, transpile only, no type check; state in .build/build-fast/
```

Then run only the affected files, in one invocation:

```bash
./scripts/test.sh src/vs/foo/test/browser/bar.test.ts [more.test.ts ...]      # bare paths = --run
./scripts/test.sh --run src/vs/foo/test/common/bar.test.ts --grep "title substring"
./scripts/test.sh --runGlob "**/contrib/foo/test/**/*.test.js"                # globs match out/*.js
./scripts/test.sh --isolate --run src/vs/foo/test/browser/bar.test.ts          # new test file: proves it passes alone
```

| Runner | Command | Loads | Use when |
|---|---|---|---|
| Electron (default) | `./scripts/test.sh` | all environments | Always valid. The first run downloads Electron into `.build/electron` via `pnpm run electron`. |
| Node | `pnpm run test-node --run <src path>` | `common` and `node` only (skips `browser`, `electron-*`) | Faster for `common`/`node` tests; needs Node at least the major in `remote/package.json`. |
| Browser | `pnpm run test-browser-no-install --browser chromium --run <src path>` | `common` and `browser` only | Web-specific behavior. Needs Playwright browsers (`pnpm run playwright-install` once). |

Useful flags: `--dev` (visible window with DevTools, Electron), `--timeout <ms>`, `--coverage`. `pnpm run test` deliberately fails; use the scripts above. Full option docs: `test/unit/README.md` and `.github/skills/unit-tests/SKILL.md`.

Where tests live: `src/vs/<layer>/<area>/test/<env>/<name>.test.ts`, where `<env>` (`common`, `browser`, `node`, `electron-browser`, ...) decides which runners load it. Use mocha TDD `suite`/`test`, call `ensureNoDisposablesAreLeakedInTestSuite()` in every suite (from `src/vs/base/test/common/utils.ts`), call `sinon.restore()` in `teardown`, and add to the relevant existing suite. `.integrationTest.ts` files are not unit tests. See `.github/instructions/writing-tests.instructions.md`.

## 4. Type check (minutes; only when warranted)

Warranted when you are not fully confident and the change is broad or cross-cutting, alters exported types or signatures used elsewhere, touches build or tsconfig, or another rung reports a compile problem. `build-fast` does not type-check.

| Changed | Command |
|---|---|
| `src/**` | `pnpm run typecheck-client` (whole `src/tsconfig.json`) |
| one built-in extension | `pnpm run gulp compile-extension:<name>`; `<name>` is the tsconfig folder under `extensions/` with `/` replaced by `-`, e.g. `git`, `json-language-features-client` |
| several built-in extensions | `pnpm run gulp compile-extensions` |
| `extensions/copilot/**` | `pnpm -C extensions/copilot run typecheck` |
| `build/**` | `pnpm -C build run typecheck` |
| `src/vs/editor/**` reachable from Monaco | `pnpm run monaco-compile-check` |
| `src/vscode-dts/**` | `pnpm run vscode-dts-compile-check` |

## 5. Layering and cycles (only when imports cross environments or layers)

Import-level layering (`base` < `platform` < `editor` < `workbench` < `sessions`; `common` < `browser`/`node` < `electron-*`; no imports into `contrib/` internals) is already enforced by oxlint in rung 1.

```bash
pnpm run valid-layers-check          # build/checker/layersChecker.ts + layersTypeCheck.ts
pnpm run check-cyclic-dependencies   # scans out/; refresh it with build-fast first
```

`valid-layers-check` additionally rejects native-only types (for example `INativeEnvironmentService`, `INativeHostService`) used from `common`/`browser`, and type-checks six per-environment projects (`build/checker/tsconfig.*.json`) at up to about 4 GB each. Run it when you add a new file under an environment folder, move code between environments, or reference a service that only exists natively.

## 6. Built-in extension and integration tests (only when relevant)

- Node.js integration tests (`*.integrationTest.ts` under `src/`): `./scripts/test-integration.sh --run src/vs/.../foo.integrationTest.ts`. Needs `out/` as for unit tests.
- Extension host suites: `./scripts/test-integration.sh --suite <name> [--grep <pattern>]`; `--help` lists suites (`git`, `typescript`, `markdown`, `emmet`, `api-folder`, ...). Build extension output first with `pnpm run build-fast` (all lanes).
- Never run the script without filters: it runs every suite. Details: `.github/skills/integration-tests/SKILL.md`. Smoke tests (`.github/skills/smoke-tests/SKILL.md`) only for end-to-end UI flows.

## 7. Manual and UI verification

For user-visible changes, run the product:

```bash
just build-dev    # build the dev product
just run-dev      # launch it
```

For agent-driven checks (clicking, screenshots, chat flows, breakpoints), use the `launch` skill, which starts Code OSS in a throwaway profile and drives it over CDP. Read process logs with `.github/skills/code-oss-logs/SKILL.md`.

## Failure signatures

| Signature | Cause | Fix |
|---|---|---|
| `<file>: Missing or bad copyright statement` | Header absent or altered | Paste the exact 4-line header from another `.ts` file at line 1 |
| `(<line>,1): Bad whitespace indentation` | Spaces used for indentation | Reindent with tabs |
| `File not formatted. Run the 'Format Document' command to fix it` | TS formatting differs from the built-in formatter | Fix spacing/braces as Format Document would, re-run `pnpm run precommit <file>` |
| `Unexpected unicode character` | Non-ASCII character such as a smart quote or emoji | Replace it, or add `// allow-any-unicode-next-line` if intended |
| `Bad layering. You are not allowed to access ...` / `Imports violates '...' restrictions` | Import from a higher layer or another environment | Move code to the correct `common`/`browser`/`node` folder, or introduce a service interface in a lower layer |
| `Imports have to end with .js` / `Imports have to be relative` | ESM import form | Use relative imports ending in `.js` |
| `Only use double-quoted strings for externalized strings` / unlocalized UI text | User-visible string not wrapped, or wrong quotes | `localize('key', "Text {0}", arg)` with double quotes; single quotes elsewhere |
| `There are N undisposed disposables!` ... `Leaking disposable` | Test or code creates disposables without disposing them | Register with `store.add(...)` / `this._register(...)`; ensure the suite calls `ensureNoDisposablesAreLeakedInTestSuite()` |
| `Suites should include a call to ensureNoDisposablesAreLeakedInTestSuite()` | Lint on a new test suite | Add `const store = ensureNoDisposablesAreLeakedInTestSuite();` at the top of the suite |
| Test not found, `Cannot find module .../out/vs/...`, or old behavior after an edit | `out/` missing or stale | `pnpm run build-fast --client-only`, then rerun the same selection |
| Test passes in a batch but fails with `--isolate` | It relies on registrations imported by another test file | Import the `*.contribution.ts` or register what it uses inside the test file |
| `node.js unit tests require a major node.js version of N` | Old Node for `test-node` | Use the Node from `.nvmrc`, or use `./scripts/test.sh` |
| oxlint `(local/code-no-any-casts)`, `(local/code-no-test-only)`, `(no-restricted-syntax)` | Banned pattern | Fix the code; do not add disable comments to pass |
| stylelint unknown `--vscode-*` variable | CSS uses an unregistered variable | Use an existing token or register the color/size and add it to `vscode-known-variables.json` |
