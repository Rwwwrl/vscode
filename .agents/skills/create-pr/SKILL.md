---
name: create-pr
description: Create a pull request for the current branch in the vsade fork (Rwwwrl/vscode, base sosov-fork) with the gh CLI — push the branch, write the title and body, open the PR and report its URL. Use when the user runs /create-pr or asks to open, create or raise a PR, or to push finished work for review.
argument-hint: [extra context for the title or body]
---

# Create a Pull Request

Every change reaches `sosov-fork` through a pull request that is squash-merged. This skill takes the current branch from "committed locally" to "open pull request" and stops there.

## The One Rule That Must Not Break

This repository is a fork, so `gh` targets the parent `microsoft/vscode` whenever it has to guess. A pull request opened there is public and cannot be taken back. Pass the repository and base explicitly on **every** `gh pr` command:

```bash
--repo Rwwwrl/vscode --base sosov-fork
```

Never run `gh pr create` without both flags, never use `--web`, and never target `microsoft/vscode` or the `main` branch.

## 1. Check the Branch

```bash
git branch --show-current
git status --short
git log --oneline origin/sosov-fork..HEAD
```

- On `sosov-fork` or `main`: stop. Work needs its own branch first; offer the `git-branch` skill.
- No commits ahead of `origin/sosov-fork`: stop and report that there is nothing to open a pull request for.
- Uncommitted changes: report them and ask whether they belong in this pull request. Do not stage or commit on your own; committing is the `commit` skill, on request.
- A `sync/*` branch: stop. Upstream syncs are landed by the `sync-upstream` skill, never squash-merged.

## 2. Check the Change

1. Confirm the work was validated with the `validate-change` skill. Reuse the earlier result if nothing changed since; if nothing was run, say so in the body rather than running broad checks now.
2. Run `just fork-patches`. It lists every upstream-owned file the branch modifies and fails on changes without a `FORK:` marker. Fix missing markers before going on (see the `fork-feature` skill). Keep the list for the body.

## 3. Push

```bash
git push -u origin "$(git branch --show-current)"
```

Never force-push unless the user asks.

## 4. Open, or Update

Look for an existing pull request of this branch first:

```bash
gh pr list --repo Rwwwrl/vscode --head "$(git branch --show-current)" --state open --json number,url,title
```

If one exists, the push already updated it: refresh its body with `gh pr edit <number> --repo Rwwwrl/vscode --body-file <file>` when the content changed, report the URL, and stop.

Otherwise write the body to a file in the scratchpad directory and create it:

```bash
gh pr create --repo Rwwwrl/vscode --base sosov-fork --head "$(git branch --show-current)" \
	--title "<title>" --body-file <file>
```

**Title.** It becomes the squash commit subject on `sosov-fork`, so it uses the `commit` skill's format: `[scope] type context past-tense-description`. With a single commit, reuse its subject. With several, write one subject that covers the whole branch.

**Body.** These three sections, in this order, and nothing else:

```markdown
## What
<one to three sentences: the behavior added or changed, from the user's point of view>

## Upstream files touched
<one bullet per file from `just fork-patches`: `path` — why this could not live in fork-owned code. Write "None — fork-owned files only." when the list is empty>

## Validation
<the commands that were actually run and their outcome; say what was not run>
```

Describe what the diff against `sosov-fork` does (`git diff origin/sosov-fork...HEAD`), not the history of how it got there. Fold any arguments passed to the skill into the title or the `What` section.

The repository is public. Keep credentials, personal data, and anything from the user's private settings or profile out of the title and body. Add no attribution or session-link footer.

## 5. Report

Print the pull request URL and its title, and stop. Do not merge.

Merging is a separate, explicit request. When the user asks for it: `gh pr merge <number> --repo Rwwwrl/vscode --squash --delete-branch` (never `--merge`, `--rebase` or `--admin`), then `git switch sosov-fork && git pull --ff-only origin sosov-fork`.

## Never

- Push commits directly to `sosov-fork` or `main`.
- Open, comment on, or otherwise touch pull requests and issues in `microsoft/vscode`.
