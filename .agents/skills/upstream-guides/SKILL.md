---
name: upstream-guides
description: "Index of the area-specific guidance that upstream VS Code ships for Copilot (.github/instructions/*.instructions.md, .github/skills/*/SKILL.md, folder-local AGENTS.md), none of which Claude Code loads automatically. Use before editing, reviewing, or designing code in any specific area of the VS Code source (workbench contribs, CSS/UI, tests, chat, Agents window, agent host, editor, build, extensions) to find and read the rules that apply to the files you are about to touch."
---

# Upstream Guides Index

**Rule: find the rows matching the files you are about to touch, Read those files fully, then proceed.** Several rows usually match (for example any `src/vs/**/browser/*.css` change matches four). `.github/copilot-instructions.md` is already loaded as CLAUDE.md; do not re-read it. Do not edit upstream guidance files in this fork (merge conflicts); put fork-specific guidance in `.agents/skills/`.

## (a) Instructions by path: `.github/instructions/<file>`

| Applies to | File | What it tells you |
|---|---|---|
| `src/vs/**` | `coding-guidelines.instructions.md` | Naming, style, strings, UI labels; largely mirrors CLAUDE.md, check for additions |
| `src/vs/**` | `source-code-organization.instructions.md` | Layer order, `common`/`browser`/`node`/`electron-*` import rules, contrib rules, entry points, DI and `registerSingleton` |
| `src/vs/**` | `best-practices.instructions.md` | Reuse `Button`/`Action`/`MenuWorkbenchToolBar`, resolve action context instead of the active editor, context keys are not state, multi-window DOM creation, `Schemas`/`isEqual` for URIs, `ResourceLabel`, editor decorations |
| `src/vs/**/browser/**/*.{ts,css}` | `design-philosophy.instructions.md` | Name the value and principle before picking a token; routes to the `design-philosophy` skill |
| `src/vs/**/*.css` | `design-tokens.instructions.md` | Spacing, radius, font size and weight, codicon size, stroke tokens and their scales |
| `**/*.css` | `css-best-practices.instructions.md` | Selector performance and state styling |
| `src/vs/**/test/**`, `*.test.ts`, `*.integrationTest.ts` | `writing-tests.instructions.md` | Test types and locations, `ensureNoDisposablesAreLeakedInTestSuite`, `sinon.restore`, snapshot tests |
| `src/vs/**/*Tool.ts`, `src/vs/**/*Tools.ts` | `language-model-tool-descriptions.instructions.md` | How to write model-facing tool descriptions (`modelDescription`) |
| `src/vs/sessions/**` | `sessions.instructions.md` | Invoke the `sessions` skill before any Agents window work |
| `src/vs/sessions/contrib/automations/browser/automationDialog*` | `automation-dialog.instructions.md` | One notification center for status; loading states as spinner hovers |
| `src/vs/editor/browser/viewParts/{minimap,overviewRuler}/**`, `findSectionHeaders.ts` | `editor-minimap.instructions.md` | Deliberate minimap behaviors not to break, and how to verify |
| `src/vs/platform/agentHost/**` | `agentHostTesting.instructions.md` | Agent Host Protocol model (state + actions), service construction doc, tool/prompt budget, running a mock agent host (its description line is wrong; the body is about Agent Host) |
| agent host and its clients (`platform/agentHost/**`, `chat/browser/{agentSessions/agentHost,remoteAgentHost}/**`, `sessions/contrib/providers/*AgentHost/**`) | `agent-host-interoperability.instructions.md` | Use protocol constructs before `_meta`; native session identity |
| agent host URIs (`platform/agentHost/{browser,common}/**`, `workbench/services/agentHost/**`, related chat/terminal/sessions files) | `agent-host-uri-spaces.instructions.md` | Which side owns a URI's space and how to map it |
| `src/vs/workbench/contrib/chat/browser/aiCustomization/**` | `ai-customization.instructions.md` | AI Customization view structure, constants, registration |
| `build/next/**` | `buildNext.instructions.md` | esbuild transpile/bundle/build-fast architecture; test with `node build/next/index.ts`, not the full build |
| `**` (commits) | `committing.instructions.md` | Respect commit signing; never `--no-verify` |

By topic (no `applyTo`; read when the topic matches):

| Topic | File | What it tells you |
|---|---|---|
| Any chat/AI feature | `chat.instructions.md` | Gate UI on `ChatContextKeys.enabled`; render agent markdown with `ChatContentMarkdownRenderer` |
| `IDisposable` lifetimes | `disposable.instructions.md` | `Disposable`, `DisposableStore`, `MutableDisposable`, `toDisposable` semantics |
| Observables | `observables.instructions.md` | `observableValue`, `derived`, `autorun`, `reader.store` patterns |
| Trees and lists in the workbench | `tree-widgets.instructions.md` | `WorkbenchObjectTree`/`WorkbenchAsyncDataTree` and friends in `listService.ts` |
| `src/vs/workbench/contrib/notebook/**` | `notebook.instructions.md` | Model resolution, viewport virtualization, cell rendering, focus |
| `src/vs/workbench/contrib/interactive/**` | `interactive.instructions.md` | Interactive window registration, model resolution, EH syncing |
| ARIA, screen readers, accessible help | `accessibility.instructions.md` | Keybinding scoping, Alt+F1 help, announcements, verbosity settings |
| Existing `publicLog2` events | `telemetry.instructions.md` | Event typing and GDPR classification; this fork's `product.json` has no telemetry backend, so avoid adding new events |

## (b) Skills by task: `.github/skills/<name>/SKILL.md`

| Task | Skill | When to use |
|---|---|---|
| Any new feature or UI change | `accessibility` | Required for new UI: help dialogs, accessible views, signals, ARIA, keyboard |
| Visual design decisions | `design-philosophy` | Choosing radius, spacing, type, icon size, color, motion; turning "feels off" into a fix |
| CSS and layout | `ux-css-layout` | CSS conventions, SplitView/Grid, rounded surfaces, clipping, scrolling, text overflow |
| Colors and states | `ux-theming` | Registering colors, hover/focus/selection precedence, high contrast |
| Tooltips | `hover` | `IHoverService`, hover delegates, placement and pointers |
| Menus | `context-menus` | Action2 `menu` entries, `MenuRegistry` group/order, submenus, separators |
| Agents window (`src/vs/sessions/**`) | `sessions` | Core principles and router to the owning spec |
| Chat Customizations editor | `chat-customizations-editor` | Management UI for agents, skills, instructions, hooks, prompts, MCP, plugins |
| Agent host turn side effects | `agent-host-chat-contributions` | Lifecycle contributions instead of growing `AgentSideEffects`/`AgentService` |
| Agent host customizations | `customizations-in-the-agent-host` | Discovery, enablement, and hand-off of plugins/MCP/agents/skills to providers |
| Agent host E2E tests | `agent-host-e2e-tests` | Writing and re-recording E2E fixtures (skip its Azure validation steps) |
| Integrated browser | `integrated-browser` | Architecture of `platform/browserView` and `contrib/browserView` |
| Chat pet sprites | `chat-pet-sprite-creation` | Sprite art under `contrib/chat/browser/widget/media/chatPet` |
| Running unit tests | `unit-tests` | All `scripts/test.sh` options; `validate-change` has the short version |
| Running integration tests | `integration-tests` | `scripts/test-integration.sh` filters and suites |
| Smoke tests | `smoke-tests` | `pnpm run smoketest`, grep filtering, flake loops |
| Component screenshots | `component-fixtures` | Writing `*.fixture.ts` for isolated UI rendering |
| Recorded UI evidence | `validate-ui-scenario` | Scripted scenario producing video, screenshots, trace; for interactive driving prefer the `launch` skill |
| Leak review | `memory-leak-audit` | Listener, DOM handler, and disposable leak checklist |
| Memory or perf investigation | `auto-perf-optimize`, `heap-snapshot-analysis`, `cpu-profile-analysis` | Drive a scenario and capture snapshots; analyze `.heapsnapshot`; analyze `.cpuprofile`/traces |
| Chat rendering perf | `chat-perf` | `pnpm run perf:chat` benchmarks and leak checks |
| Reading dev-build logs | `code-oss-logs`, `agent-host-logs` | Locate `main.log`/`renderer.log`/exthost logs; analyze Agent Host log bundles |
| Code review | `code-review` | Upstream review checklist for correctness, regressions, scope |
| Fork bookkeeping | `author-contributions` | List files an author changed on a branch vs upstream, through renames |
| Planning a large change | `component` | Template for a component overview before implementing (prompt-style skill) |
| `vscode.d.ts` doc comments | `doc-comments` | Rules for public API doc comments (prompt-style skill) |

## (c) Folder-local guides (also not auto-loaded)

Read the nearest one when touching its folder: `.eslint-plugin-local/AGENTS.md` (writing lint rules), `src/vs/platform/agentHost/AGENTS.md` (living spec; §9 for tools and prompt text), `src/vs/platform/agentHost/common/state/AGENTS.md` (protocol versioning), `src/vs/platform/agentHost/node/copilot/prompts/AGENTS.md` (system prompt customization), `src/vs/platform/agentHost/test/node/AGENTS.md` (in-memory `SessionDatabase` in tests), `src/vs/platform/agentHost/node/serviceBootstrapping.md` (node service placement), `src/vs/workbench/contrib/imageCarousel/AGENTS.md`, `src/vs/sessions/README.md`. Under `extensions/copilot/`: `.github/copilot-instructions.md` (overall), `.github/instructions/{prompt-tsx,model-prompts,vitest-unit-tests}.instructions.md` (`*.tsx`, `src/extension/prompts/node/agent/**`, `*.spec.ts`), `src/extension/chatSessions/copilotcli/AGENTS.md`, `src/platform/authentication/common/AGENTS.md`.

## Not applicable to this fork

Microsoft-internal or upstream-process only, skip: instructions `kusto`, `oss`, `oss-third-party-notices`, `rulesets`, `learnings`; skills `azure-pipelines`, `build-champ-triage`, `endgame-status`, `sweeper-plan`, `sweeper-implement`, `sweeper-query`, `issue-grouping`, `migrate-issues`, `fixissueno`, `codenotify`, `fix-ci-failures`, `ci-artifact-testing`, `flaky-smoke-tests`, `symbolicate-crash-dump`, `update-screenshots`, `experiments`, `feature-tryouts`, `policy-and-managed-settings`, `otel`, `vscode-dev-workbench`, `setup-environment`, `feedback-learning`, `update-instructions`; agent `.github/agents/data.md`.
