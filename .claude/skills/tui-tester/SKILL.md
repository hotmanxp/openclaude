---
name: tui-tester
description: Expert guidance for testing OpenCC behavior and visual output using terminal automation.
---

# TUI Tester Skill

This skill provides the operational manual for verifying OpenCC behavioral changes and visual output using terminal automation.

## Core responsibilities

- **Verify Behavior**: Confirm that code changes result in the expected terminal interactions.
- **Visual Validation**: Ensure the TUI renders correctly across different terminal sizes and states.
- **Regression Testing**: Use automation to prevent breaking existing interactive workflows.

## Critical Protocol

When performing TUI testing, you must adhere to these strict rules:

### 1. Initialization
**YOUR ABSOLUTE FIRST ACTION MUST BE:**
Activate the `agent-tui` skill. This provides the underlying tools needed for terminal automation.

### 2. Environment Setup (macOS / Parallel Safe)
Ensure the global daemon is running and the live preview is open:
```bash
if ! agent-tui sessions >/dev/null 2>&1; then
  tmux kill-session -t agent-tui 2>/dev/null || true
  agent-tui daemon stop 2>/dev/null || true
  rm -f /tmp/agent-tui*
  tmux new-session -d -s agent-tui 'agent-tui daemon start --foreground > /tmp/agent-tui-daemon.log 2>&1'
  sleep 1
fi
agent-tui live start --open
```

### 3. Session Management
- **Session IDs**: Always use the `session_id` returned by `agent-tui run` for subsequent interactions.
- **Atomic Execution**: Execute exactly one command per turn. Do not pipeline actions.
- **The Loop**: Action -> Wait -> Screenshot -> Verify -> Next Action.

### 4. OpenCC Specifics
- **Build First**: Always run `bun run build` before testing local changes.
- **Bypass Modals**: Set appropriate environment variables to avoid focus-stealing modals.
- **Isolate Config**: Use environment variables to prevent interference with personal settings.

## Debugging MCP Tool List Ghost Artifacts

This workflow is specifically designed for debugging rendering issues like the `/mcp` dialog ghost characters:

### Step 1: Build and Launch
```bash
# Build opencc first
cd /Users/ethan/code/opencc && bun run build

# Start the TUI with /mcp command
agent-tui run bun run dev -- -p "test"
```

### Step 2: Navigate to /mcp
```bash
# Wait for initial prompt to appear
agent-tui wait "❯" --assert

# Type /mcp command
agent-tui type "/mcp"
agent-tui press Enter

# Wait for MCP dialog to render
agent-tui wait "Manage MCP servers" --assert
```

### Step 3: Observe and Identify Issues
```bash
# Take a screenshot to see the current state
agent-tui screenshot

# Look for ghost characters (extra letters like 't', 'c', vertical bars)
# Note the exact position and nature of any artifacts
```

### Step 4: Diagnose with Resize
```bash
# Resize terminal to different dimensions to trigger/reveal issues
agent-tui resize --cols 120 --rows 30
agent-tui wait --stable
agent-tui screenshot

agent-tui resize --cols 80 --rows 24
agent-tui wait --stable
agent-tui screenshot
```

### Step 5: Trace the Render Path
Based on what you observe:
- If ghost characters appear at row ends → likely `output.write` not clearing to end-of-line
- If columns misalign → likely TwoColumnRow or flex layout calculation issue
- If characters repeat → likely `prevScreen` blit restoring stale content

## Workflow Example: Testing /mcp Dialog

```bash
# Start opencc
agent-tui run bun run dev -- -p "test"

# Wait for the prompt
agent-tui wait "❯" --assert

# Open MCP dialog
agent-tui type "/mcp"
agent-tui press Enter
agent-tui wait "Manage MCP servers" --assert

# Verify no ghost characters in server list
agent-tui screenshot

# Navigate with arrow keys
agent-tui press ArrowDown
agent-tui screenshot

# Exit dialog
agent-tui press Escape
agent-tui wait "❯" --assert
```

## Error Recovery
If a wait times out, take a fresh screenshot to diagnose the state:
```bash
agent-tui screenshot
# Analyze what is actually shown
# If you see "os error 61", restart daemon:
#   tmux kill-session -t agent-tui
#   agent-tui daemon start
```
