---
name: clean-worktree
description: Safely enumerate, classify, and remove stale git worktrees and branches (cherry-pick, merge-agent, fork-from-old-base). Use when user mentions cleanup worktrees, clean branches, prune old pick/merge branches, git worktree list looks bloated, or after batch cherry-pick / merge operations.
---

# Clean Worktree

## Overview

When a repo has accumulated dozens of cherry-pick / merge-agent / detached worktrees from batch operations, this skill provides a **4-phase safe cleanup**: enumerate → classify → confirm → destroy. The key safeguard is checking for dirty state before each remove — this saved `python/requirements.txt` from being deleted on 2026-06-27.

## Phase 1: Enumerate

```bash
git worktree list --porcelain | awk '/^worktree/ {path=$2} /^HEAD/ {commit=$2} /^branch/ {branch=$2; print path "\t" branch "\t" commit}'
git for-each-ref --format='%(refname:short) %(committerdate:short) %(objectname:short)' refs/heads/
```

Output is the candidate set. **Do not skip this phase** — without enumeration you cannot classify.

## Phase 2: Classify

For each worktree, run **3 checks** in order:

```bash
# (1) Dirty state — CRITICAL, must come first
git -C <wt> status --short

# (2) Unique commits vs main branch
git rev-list --count <branch> --not main-opencc    # ahead=N

# (3) For ahead≥1: peek the actual commits
git log --oneline <branch> --not main-opencc | head -5
```

### Classification rules

| Signal | Class | Action |
|---|---|---|
| `status --short` non-empty | **ACTIVE** | skip — user has unsaved work |
| ahead=0 | **FULLY MERGED** | safe to delete |
| ahead=1 with upstream PR SHA in title | **CHERRY-PICK (DO-NOT-MERGE / ABORTED)** | safe to delete — reflog retains commit |
| ahead=1 with `fix(opencc-port)` / `feat(opencc-)` prefix | **OPENCC OWNED** | ask user |
| ahead≥100 | **FORK-FROM-OLD-BASE** | check merge-base; if upstream-only commits, safe to delete |
| branch tip matches an active worktree's `main-upstream` / `main` | **UPSTREAM MIRROR COPY** | safe to delete — upstream already kept |

### Why this matters

- **Dirty-state check first**: 2026-06-27 caught `sync-dynamic-workflow`'s stale `python/requirements.txt` modification.
- **ahead=0 ≠ "no work"**: must check both directions (`branch --not main` AND `main --not branch`) — a branch with 0 unique commits can still be the only place holding a cherry-pick's conflict-resolution history if not yet merged.
- **Fork-from-old-base**: `main-opencc` has advanced 162 commits since fork, so the fork's unique commits are mostly upstream history now in upstream's own worktree. If user has a `main-upstream`/`main-upper` worktree preserving upstream, the fork copies are redundant.
- **Cherry-pick ABORTED commits are recoverable** via `git reflog | grep <sha>` even after `git branch -D`.

## Phase 3: Confirm with user

Present the classification table via AskUserQuestion. Default to **"all proposed = delete"** with explicit option for the OPENCC OWNED subset. Never auto-delete ahead≥1 OpenCC-owned branches without confirmation — they may carry OpenCC-specific conflict resolution worth keeping.

## Phase 4: Destroy

```bash
# Detached worktrees first (no branch to delete)
git worktree remove --force /path/to/detached-wt

# Branched worktrees
git worktree remove --force /path/to/wt
git branch -D <branch-name>   # only after worktree removed
```

Verify final state:

```bash
git worktree list
git for-each-ref --format='%(refname:short)' refs/heads/ | sort
```

## Reserved worktrees (never delete without explicit user override)

The following worktree types are **always preserved** during automated cleanup:

| Pattern | Reason |
|---|---|
| Path matching primary checkout (e.g. `/Users/ethan/code/<repo>`) | Current working directory |
| Branch named `opencc-release` / `release` | Release worktree — symlinked from `~/.bun/bin/<bin>` |
| Branch named `main-upper` / `main-upstream` / `main-mirror` | Upstream mirror — local copy of `origin/main` for cherry-pick base |
| Branch ending in `-worktree` (active, has recent commits) | User-declared active workspace |
| Branch matching `feat/*` / `fix/*` with commits ahead of main | OpenCC-owned feature branch in progress |

These are detected automatically — **no user confirmation needed** to keep them. Only ask when the cleanup targets a branch that *looks like* one of these but is actually stale (e.g. `feat/dynamic-workflow` whose commits are already merged).

## Anti-patterns

- ❌ `git worktree remove` without `--force` when worktree has uncommitted changes — fails silently
- ❌ `git branch -D <branch>` while a worktree still references it — leaves worktree in broken state
- ❌ Bulk `git worktree prune` without inspection — destroys data without classification trail
- ❌ Trusting `git worktree list` exit code alone — detached worktrees don't show a branch field
- ❌ Skipping dirty-state check — the #1 way to lose work

## Reference

For the full 2026-06-27 cleanup log (54 → 3 worktrees, 49 → 19 branches), see memory at `opencc-worktree-cleanup-check-dirty-state-before-remove-2026-06-27` (team feedback).
