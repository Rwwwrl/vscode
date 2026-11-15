---
name: sync-upstream
description: Bring the latest microsoft/vscode changes into the vsade fork — fast-forward the main mirror, merge it into sosov-fork, resolve conflicts at fork patch points, and land the merge commit. Use only when the user explicitly asks to sync, update, or pull from upstream.
---

# Sync With Upstream

Remotes: `upstream` is `microsoft/vscode`, `origin` is the fork `Rwwwrl/vscode`. `main` mirrors `upstream/main` exactly and never carries fork commits. `sosov-fork` is `main` plus squashed fork commits plus one merge commit per sync.

A sync is landed as a real **merge commit**. Squashing or rebasing it would drop the upstream parent, and every later sync would then conflict on all of upstream's history again. That makes this the single case where `sosov-fork` is updated without a squash-merged pull request.

## 1. Preconditions

- `git status --short` is clean. If not, stop.
- No fork work is half-landed: list open pull requests with `gh pr list --repo Rwwwrl/vscode --base sosov-fork` and tell the user they will need a rebase or merge afterwards.

## 2. Update the Mirror

```bash
git fetch upstream main
git switch main
git merge --ff-only upstream/main
git push origin main
```

If the fast-forward fails, `main` has diverged from upstream. Stop and report; do not merge or reset.

## 3. Merge Into a Sync Branch

```bash
git switch sosov-fork
git pull --ff-only origin sosov-fork
git switch -c "sync/upstream-$(date +%Y-%m-%d)"
git merge --no-ff main -m "[root] chore sync merged upstream main $(git rev-parse --short main)"
```

## 4. Resolve Conflicts

Conflicts can only occur in upstream-owned files the fork patched. `just fork-patches` (run it on `sosov-fork` before the merge if you need the list) and `git grep -n 'FORK:' -- ':!.agents' ':!CLAUDE.md' ':!scripts/vsade'` show every patch point.

For each conflicted file:

1. Take upstream's side as the baseline: understand what upstream changed and why.
2. Re-apply the fork hunk on top, keeping its `FORK:` marker. If upstream moved or renamed the code, move the hunk with it. If upstream now provides the behavior, or an extension point that makes the patch unnecessary, drop the hunk and say so in the report.
3. Never resolve by discarding upstream changes wholesale.

`product.json`: keep the fork's identity fields and `extensionsGallery`, take everything else from upstream. `pnpm-lock.yaml` and other generated files: take upstream's version, then regenerate with `pnpm install` rather than hand-merging.

Fork-owned files (`justfile`, `CLAUDE.md`, `.agents/skills/` entries added by the fork, `scripts/vsade/`, fork contrib folders and extensions) should not conflict. If one does, upstream started using that path: report it.

## 5. Verify

1. `pnpm install` if `pnpm-lock.yaml`, `package.json`, or `.npmrc` changed.
2. `just build-dev`, then follow the `validate-change` skill for the areas the fork patches: type check, the fork's own unit tests, `just fork-patches`.
3. `just run-dev` and exercise each fork feature once. APIs that fork code calls may have changed without a textual conflict.

Fix breakage in fork-owned code where possible, in additional commits on the sync branch.

## 6. Land

Show the user the summary first: upstream range merged, conflicted files and how each was resolved, hunks dropped, verification results. Landing pushes directly to the trunk, so wait for an explicit go-ahead in the current turn.

```bash
git push -u origin "$(git branch --show-current)"
git switch sosov-fork
git merge --ff-only "sync/upstream-<date>"
git push origin sosov-fork
git push origin --delete "sync/upstream-<date>"
```

The push to `sosov-fork` is accepted because the repository admin may bypass the branch ruleset; GitHub prints a bypass notice. Never use `--force`. If the user prefers a record on GitHub, open a pull request for the sync branch first (`gh pr create --repo Rwwwrl/vscode --base sosov-fork ...`); the direct push then closes it as merged. Do not press or run a squash merge on it.

## Never

- Run this without being asked, or as a side effect of another task.
- Rebase `sosov-fork`, or merge `upstream/main` into a feature branch.
- Commit anything to `main`.
