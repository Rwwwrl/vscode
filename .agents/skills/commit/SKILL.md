---
name: commit
description: Commit vsade fork changes using the fork's subject format and strict staged-only safety. Use only when the user explicitly asks in the current turn to commit, create a commit, or commit staged changes.
---

# Commit Staged Changes

Commit exactly the index snapshot prepared by the user. Never stage or otherwise reshape it.

## Inspect the Index

1. Run `git branch --show-current`. If it is `sosov-fork` or `main`, stop: `sosov-fork` only receives squash-merged pull requests and `main` mirrors upstream. Offer the `git-branch` skill instead.
2. Run `git status --short`.
3. Run `git diff --cached --name-status` and `git diff --cached`.
4. Use `git diff` only to understand which unstaged edits must remain excluded.
5. If `git diff --cached --quiet` succeeds, stop and report that nothing is staged.

Never run `git add`, `git commit -a`, `git reset`, `git restore --staged`, or `git stash`. Never pass pathspecs to `git commit`.

If the index mixes unrelated concerns, do not split or restage it. Ask the user to stage one concern at a time.

## Write the Subject

Use one line:

```text
[scope] type context past-tense-description
```

The bracketed scope is what tells fork commits apart from upstream's `area: summary` subjects in `git log`. Choose it from the staged paths:

- `[fork]` for fork infrastructure: `product.json`, `justfile`, `CLAUDE.md`, `.agents/skills/`, `scripts/vsade/`
- `[workbench]` for `src/vs/workbench/`
- `[sessions]` for `src/vs/sessions/`
- `[editor]` for `src/vs/editor/`
- `[platform]` for `src/vs/platform/`
- `[base]` for `src/vs/base/`
- `[code]` for `src/vs/code/` and `src/vs/server/`
- `[extensions]` for `extensions/`
- `[build]` for `build/`, `scripts/` and `test/` infrastructure
- `[root]` for changes that span several of the above

Choose `feat`, `fix`, or `chore`. Put refactors, tests, formatting, documentation, and configuration maintenance under `chore` unless the staged behavior clearly warrants `feat` or `fix`.

Name the principal file or area as the context and describe the completed change concisely:

```text
[workbench] feat vsadeTabGroups added named tab group switcher
[editor] fix cursorMoveCommands.ts kept selection on wrapped line jump
[extensions] feat vsade-notes added quick capture command
[fork] chore justfile added build-dev recipe
```

Do not add a body or a `Co-Authored-By` / session-link trailer unless the user explicitly requests one. The repository is public: nothing confidential or personal goes in the subject.

## Commit and Verify

Run only:

```bash
git commit -m "<subject>"
```

Respect the user's signing configuration and never pass `--no-verify`. If the commit fails or a hook modifies files, re-run `git status --short` and `git diff --cached`; stop without staging hook edits or retrying automatically.

After success, verify the new `HEAD`, report the subject, and mention any remaining unstaged or untracked files. Never amend unless explicitly requested in the current turn. Never push to `sosov-fork` or `main`; landing goes through the `pull-request` skill.
