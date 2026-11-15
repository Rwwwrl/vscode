---
name: pull-request
description: Open, update, or squash-merge a pull request in the vsade fork (Rwwwrl/vscode, base sosov-fork). Use when the user asks to push a branch, open or create a PR, update a PR, or merge/land finished work. Every change to sosov-fork lands this way.
argument-hint: [open | merge <number>]
---

# Pull Requests in the Fork

Every change reaches `sosov-fork` through a pull request that is **squash-merged**. The only exception is the merge commit made by the `sync-upstream` skill.

## The One Rule That Must Not Break

This repository is a fork, so `gh` targets the parent `microsoft/vscode` whenever it has to guess. A pull request opened there is public and cannot be taken back. Pass the repository and base explicitly on **every** `gh pr` command, with no exceptions:

```bash
--repo Rwwwrl/vscode --base sosov-fork
```

Never run `gh pr create` without both flags, never use `--web` or `--fill` alone, and never target `microsoft/vscode` or the `main` branch.

## Open

1. Check the branch: `git branch --show-current` must not be `sosov-fork` or `main`. `git status --short` should be clean; if it is not, report it and ask, do not stage or commit on your own (see the `commit` skill).
2. Confirm the work was validated with the `validate-change` skill. Reuse the earlier result if nothing changed since.
3. Run `just fork-patches`. It lists every upstream-owned file the branch modifies and fails on hunks without a `FORK:` marker. Fix missing markers before going on (see the `fork-feature` skill).
4. Push: `git push -u origin "$(git branch --show-current)"`. Never force-push unless the user asks.
5. Create the pull request:

	```bash
	gh pr create --repo Rwwwrl/vscode --base sosov-fork --head "$(git branch --show-current)" \
		--title "<title>" --body-file <file>
	```

	The title becomes the squash commit subject on `sosov-fork`, so write it in the `commit` skill's format: `[scope] type context past-tense-description`.

	Body, in this order and nothing else:

	```markdown
	## What
	<one to three sentences: the behavior added or changed, from the user's point of view>

	## Upstream files touched
	<one bullet per file from `just fork-patches`: `path` — why this could not live in fork-owned code. Write "None — fork-owned files only." when the list is empty>

	## Validation
	<the commands that were actually run and their outcome; say what was not run>
	```

6. Report the pull request URL and stop. Do not merge unless the user asked for it in this turn.

The repository is public. Keep credentials, personal data, and anything from the user's private settings or profile out of titles, bodies, and comments.

## Merge

Only when the user explicitly asks to merge or land:

```bash
gh pr view <number> --repo Rwwwrl/vscode --json state,mergeable,baseRefName,headRefName,title
gh pr merge <number> --repo Rwwwrl/vscode --squash --delete-branch
```

Check that `baseRefName` is `sosov-fork` first. Always `--squash`; never `--merge`, `--rebase`, or `--admin`. If the pull request is not mergeable, report why and stop instead of resolving it on your own.

Afterwards bring the local trunk up to date and report the new `HEAD`:

```bash
git switch sosov-fork
git pull --ff-only origin sosov-fork
```

## Never

- Push commits directly to `sosov-fork` or `main`.
- Open, comment on, or otherwise touch pull requests and issues in `microsoft/vscode`.
- Merge a `sync/*` pull request with squash; that belongs to the `sync-upstream` skill.
