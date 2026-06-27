---
name: release-local
description: Sync the latest main-opencc commits into the opencc-release worktree at /Users/ethan/code/opencc-release and run `bun run build` so the locally installed opencc (symlinked at ~/.bun/bin/opencc → /Users/ethan/code/opencc-release/bin/opencc) reflects the most recent main-opencc. Use when the user says "更新本地 opencc", "build local opencc", or wants the local opencc install to match main-opencc HEAD. Does NOT push to origin.
---

# release-local

Update the locally installed opencc binary to match the latest main-opencc commits by syncing the opencc-release worktree and rebuilding.

## Why this works

- `~/.bun/bin/opencc` is a symlink to `/Users/ethan/code/opencc-release/bin/opencc`
- That bin script invokes `node dist/cli.mjs` from the release worktree
- Building in the release worktree refreshes `dist/cli.mjs` → the user's `opencc` command picks up the change

## Workflow

Run from the main worktree root (`/Users/ethan/code/opencc`):

- [ ] **Stage and commit** any uncommitted changes on main-opencc. Use the repo's conventional-commit style; one commit per logical change. If the tree is already clean, skip this step.
  ```bash
  cd /Users/ethan/code/opencc
  git status
  git add <files>
  git commit -m "fix(<scope>): <description>"
  ```
- [ ] **Merge main-opencc into opencc-release** in the release worktree. Uses `--no-ff` to match the existing release-prep pattern of explicit merge commits (see `team/opencc-release-worktree-state-2026-06-19`).
  ```bash
  cd /Users/ethan/code/opencc-release
  git merge main-opencc --no-ff \
    -m "Merge main-opencc into opencc-release (<short-sha> <summary>)"
  ```
- [ ] **Build** in the release worktree:
  ```bash
  cd /Users/ethan/code/opencc-release
  bun run build
  ```
- [ ] **Verify** the resulting HEAD, version, and that the symlink still resolves:
  ```bash
  cd /Users/ethan/code/opencc-release
  git rev-parse HEAD
  grep '"version"' package.json
  readlink ~/.bun/bin/opencc
  ```

## Report back

After completion, report:

- main-opencc short SHA at time of sync
- opencc-release merge commit SHA
- `dist/cli.mjs` build result (look for `✓ Built opencc v<version>`)
- Confirm `~/.bun/bin/opencc` still resolves to the release worktree

## Constraints

- **Never push to origin** — push requires explicit user confirmation per project AGENTS.md. After this skill runs, `origin/opencc-release` may lag; the local install is updated, the remote is not.
- Do not modify `package.json` version here — version bumps are release-prep work, not part of this sync.
- If the merge has conflicts, stop and report. The release worktree is normally a superset of main-opencc, so conflicts are rare; if they appear, the user should resolve them manually before continuing.
- Run `bun install` in the release worktree first if a fresh `node_modules` is needed (e.g. after pulling a commit that adds a new dep); see `team/opencc-stale-nodemodules-fresh-worktree-blocker-2026-06-11`.
