---
name: git-branch
description: Derive and create a safe vsade fork Git branch from a task description. Use when the user asks to create, start, name, or switch to a new branch for a task, issue, feature, fix, refactor, or maintenance change.
argument-hint: [task description]
---

# Create a Git Branch

Create one concise branch from the task description without changing or synchronizing repository history.

## Choose the Base

The fork's trunk is `sosov-fork`. `main` is a read-only mirror of `microsoft/vscode` and is never a base for fork work.

1. Inspect the current branch, `HEAD` SHA, and `git status --short`.
2. Use the user-specified base when provided, unless it is `main` or an `upstream/*` ref; in that case stop and confirm, because work based there cannot be merged into `sosov-fork` cleanly.
3. Otherwise, branch from the current local `sosov-fork`.
4. If the current branch is not `sosov-fork` and no base was specified, stop and ask whether to use current `HEAD` or `sosov-fork`. Do not silently stack work on another feature branch.

Do not fetch, pull, reset, rebase, merge, stash, or discard changes. Existing staged, unstaged, and untracked state moves to the new branch; report that state after creation.

## Derive the Name

```text
prefix/lowercase-kebab-description
```

Select the prefix:

- `feature/` for new behavior; use this by default
- `fix/` for an explicit defect
- `refactor/` for behavior-preserving restructuring
- `chore/` for maintenance or configuration
- `sync/` is reserved for the `sync-upstream` skill
- Honor an explicit user-provided prefix

Remove filler words and punctuation. Keep the slug short and specific. If the task includes an issue number, put it before the slug:

```text
feature/named-tab-groups
feature/42-quick-capture-notes
fix/terminal-focus-after-split
chore/justfile-install-recipe
```

## Validate and Create

1. Validate with `git check-ref-format --branch "<name>"`.
2. Check both `refs/heads/<name>` and the existing `refs/remotes/origin/<name>` for collisions. Do not fetch automatically.
3. Create the branch with `git switch -c "<name>" <base>`.
4. Verify the active branch and report its name, base SHA, and carried working-tree state.

If the name already exists, stop and report the collision. Do not switch to, delete, rename, or overwrite an existing branch without explicit direction.
