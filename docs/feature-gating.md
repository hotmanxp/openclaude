# Feature Flag Lifecycle

OpenCC 把 feature flag 分为 4 个生命周期状态。`scripts/build.ts:21-63`
的 `featureFlags` 字典中每一项对应一种状态。

## 4 States

| State | 字典值 | src/ 中 `feature('X')` 守卫 | 含义 |
|-------|--------|---------------------------|------|
| **enabled** | `true` | **已消除**（固化后） | flag 在 open build 中可用，源码已 inline 真实分支 |
| **disabled** | `false` | 保留 | flag 在 open build 中不可用，源码保留 `if (feature('X'))` 守卫（runtime kill switch） |
| **solidified** | (历史状态) | 已被消除 | flag 历史上 `=true` 后被 inline 进 src/，字典可以删（如果未来要重启用，需重新加守卫） |
| **stubbed** | 字典外但 src/ 有 | preprocess 替换为 `false` | 字典未列出，源码守卫已死码（preprocess 永远 false）。本计划不处理，未来单独清理 |

## 字典当前状态（2026-06-13）

- **enabled** (22): HISTORY_SNIP / MCP_SKILLS / COORDINATOR_MODE / BUILTIN_EXPLORE_PLAN_AGENTS / BUDDY / MONITOR_TOOL / TEAMMEM / MESSAGE_ACTIONS / DUMP_SYSTEM_PROMPT / CACHED_MICROCOMPACT / AWAY_SUMMARY / TRANSCRIPT_CLASSIFIER / ULTRATHINK / TOKEN_BUDGET / HISTORY_PICKER / QUICK_SEARCH / SHOT_STATS / EXTRACT_MEMORIES / FORK_SUBAGENT / VERIFICATION_AGENT / PROMPT_CACHE_BREAK_DETECTION / HOOK_PROMPTS
- **disabled** (14): VOICE_MODE / PROACTIVE / KAIROS / BRIDGE_MODE / DAEMON / AGENT_TRIGGERS / ABLATION_BASELINE / CONTEXT_COLLAPSE / COMMIT_ATTRIBUTION / UDS_INBOX / BG_SESSIONS / WEB_BROWSER_TOOL / CHICAGO_MCP / COWORKER_TYPE_TELEMETRY

## 转换路径

```
disabled ──(flip to true)──> enabled ──(solidify pass)──> solidified
   ↑                                                       │
   └────────────(re-enable guard)─────────────────────────┘
```

## 工具

- `scripts/check-feature-solidify.ts` — build-time 正向守卫
- `scripts/feature-flags-source-guard.test.ts` — 反向守卫（#856）

## 实施

设计 spec: `docs/superpowers/specs/2026-06-13-feat-solidify-design.md`
实施计划: `docs/superpowers/plans/2026-06-13-feat-solidify-plan.md`
