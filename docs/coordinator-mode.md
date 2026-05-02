# Coordinator Mode

Coordinator mode transforms Open CC into an **orchestrator of multi-worker software engineering tasks**. The coordinator (the main AI) delegates research, implementation, and verification work to worker sub-agents while focusing on:

- Understanding user goals
- Directing workers to specific tasks
- Synthesizing results from workers
- Communicating with the user

## Enabling Coordinator Mode

### Configuration Methods

1. **Settings.json** (`coordinatorMode` boolean field):
   ```json
   { "coordinatorMode": true }
   ```

2. **Feature Flag Gate** — `COORDINATOR_MODE` feature flag must be enabled

### Detection Logic

```typescript
// src/coordinator/coordinatorMode.ts:38-49
export function isCoordinatorMode(): boolean {
  if (!feature('COORDINATOR_MODE')) {
    return false
  }
  const settings = getSettingsForSource('userSettings')
  return settings?.coordinatorMode === true
}
```

## Architecture Overview

```
┌─────────────────────────────────────────────────────────────┐
│                        User                                  │
│                          │                                   │
│                          ▼                                   │
│  ┌─────────────────────────────────────────────────────┐   │
│  │              Coordinator (Main Thread)               │   │
│  │  • Understands user goals                             │   │
│  │  • Spawns/stops workers                               │   │
│  │  • Synthesizes results                                │   │
│  │  • Communicates with user                             │   │
│  └─────────────────────────────────────────────────────┘   │
│           │              │              │                    │
│           ▼              ▼              ▼                    │
│  ┌────────────┐  ┌────────────┐  ┌────────────┐            │
│  │  Worker 1  │  │  Worker 2  │  │  Worker 3  │            │
│  │ (Research) │  │(Implement) │  │(Verify)    │            │
│  └────────────┘  └────────────┘  └────────────┘            │
└─────────────────────────────────────────────────────────────┘
```

## Tool Sets

### Coordinator (Main Thread) Tools

| Allowed Tools | Purpose |
|---------------|---------|
| `AGENT_TOOL_NAME` | Spawn worker sub-agents |
| `TASK_STOP_TOOL_NAME` | Stop misdirected workers |
| `SEND_MESSAGE_TOOL_NAME` | Continue existing workers |
| `SYNTHETIC_OUTPUT_TOOL_NAME` | Generate structured output |
| `ASK_USER_QUESTION_TOOL_NAME` | Clarify requirements with user |
| `CRON_CREATE_TOOL_NAME` | Schedule recurring or one-shot tasks |
| `CRON_DELETE_TOOL_NAME` | Cancel scheduled tasks |
| `CRON_LIST_TOOL_NAME` | List active scheduled tasks |
| Shell tools (Bash) | Run shell commands only |

**Key constraint**: Coordinator should NOT use tools for code analysis/modification — delegate these to workers.

### Worker (Sub-agent) Tools

| Allowed Tools | Disallowed Tools |
|---------------|------------------|
| `FILE_READ_TOOL_NAME` | `AGENT_TOOL_NAME` (prevents recursion) |
| `WEB_SEARCH_TOOL_NAME` | `TASK_OUTPUT_TOOL_NAME` |
| `GREP_TOOL_NAME` | `EXIT_PLAN_MODE_V2_TOOL_NAME` |
| `WEB_FETCH_TOOL_NAME` | `ENTER_PLAN_MODE_TOOL_NAME` |
| `GLOB_TOOL_NAME` | `ASK_USER_QUESTION_TOOL_NAME` |
| `FILE_EDIT_TOOL_NAME` | `TASK_STOP_TOOL_NAME` |
| `FILE_WRITE_TOOL_NAME` | `WORKFLOW_TOOL_NAME` (if feature enabled) |
| `NOTEBOOK_EDIT_TOOL_NAME` | |
| `SHELL_TOOL_NAME` | |
| `SKILL_TOOL_NAME` | |
| `TOOL_SEARCH_TOOL_NAME` | |
| `ENTER_WORKTREE_TOOL_NAME` | |
| `EXIT_WORKTREE_TOOL_NAME` | |

## Spawning Workers

Coordinator spawns workers using `AgentTool` with `subagent_type: "worker"`:

```typescript
// Key behavior in AgentTool.tsx when coordinator mode is active:
// 1. All agent spawns run asynchronously (shouldRunAsync = true)
// 2. Workers use the 'worker' subagent type
// 3. Workers get their own tool pool assembled independently
// 4. Workers run with permissionMode of 'acceptEdits' by default
```

Workers return results via `<task-notification>` XML messages:

```xml
<task-notification>
<task-id>{agentId}</task-id>
<status>completed|failed|killed</status>
<summary>{human-readable status summary}</summary>
<result>{agent's final text response}</result>
<usage>
  <total_tokens>N</total_tokens>
  <tool_uses>N</tool_uses>
  <duration_ms>N</duration_ms>
</usage>
</task-notification>
```

## Continuing/Stopping Workers

| Action | Tool | Parameters |
|--------|------|------------|
| Continue worker | `SEND_MESSAGE_TOOL_NAME` | `to: agent-id`, `message: "..."` |
| Stop worker | `TASK_STOP_TOOL_NAME` | `task_id: "agent-id"` |

## Scheduling Recurring Tasks

Coordinator can schedule tasks to run at fixed intervals using cron expressions:

| Tool | Purpose | Parameters |
|------|---------|------------|
| `CRON_CREATE_TOOL_NAME` | Schedule a recurring or one-shot task | `cron`, `prompt`, `recurring`, `durable` |
| `CRON_DELETE_TOOL_NAME` | Cancel a scheduled task | `id` |
| `CRON_LIST_TOOL_NAME` | List all active scheduled tasks | — |

**Cron format**: 5-field expression in local time (`minute hour day-of-month month day-of-week`)

Examples:
- `* * * * *` — every minute
- `0 9 * * 1-5` — weekdays at 9am
- `30 14 28 2 *` — Feb 28 at 2:30pm

## Session Persistence

Coordinator mode state is saved to session storage and restored on resume:

- Mode saved as `'coordinator'` or `'normal'`
- `matchSessionMode()` can automatically switch mode to match previous session by updating settings.json
- Session resume UI shows mode matching option

## Key Files

| File | Purpose |
|------|---------|
| `src/coordinator/coordinatorMode.ts` | Core coordinator mode logic, tool sets, system prompt |
| `src/coordinator/workerAgent.ts` | Worker agent definition |
| `src/constants/tools.ts` | Tool set definitions |
| `src/tools/AgentTool/AgentTool.tsx` | AgentTool implementation, async spawn |
| `src/tools/AgentTool/agentToolUtils.ts` | `filterToolsForAgent()` function |
| `src/tools/AgentTool/builtInAgents.ts` | Built-in agents with coordinator branching |
| `src/tools/AgentTool/prompt.ts` | AgentTool prompt, coordinator-specific slim prompt |
| `src/utils/toolPool.ts` | `applyCoordinatorToolFilter()` |
| `src/utils/systemPrompt.ts` | System prompt with coordinator branching |
| `src/utils/settings/types.ts` | `coordinatorMode` setting schema |
| `src/components/Settings/Config.tsx` | UI toggle for coordinator mode |
| `src/hooks/toolPermission/handlers/coordinatorHandler.ts` | Coordinator permission flow |

## Best Practices

1. **Delegate** — Use workers for all code analysis and modification
2. **Parallelize** — Launch independent workers in parallel
3. **Synthesize** — Collect and summarize worker results before directing follow-up
4. **Clarify** — Use `ASK_USER_QUESTION_TOOL_NAME` when requirements are unclear
5. **Schedule** — Use cron tools to set up recurring monitoring or check tasks
6. **Stop Misdirected** — Use `TASK_STOP_TOOL_NAME` to cancel off-target workers
