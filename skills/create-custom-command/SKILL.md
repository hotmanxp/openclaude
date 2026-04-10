---
name: create-openclaude-custom-command
description: Generate custom commands for OpenClaude
allowed-tools: [Bash, Write, Read]
user-invocable: true
context: inline
---

# Create OpenClaude Custom Command

Generate a custom command for OpenClaude based on the user's requirements and save it to `~/.claude/commands/`.

## Custom Command Format

Custom commands are markdown files with YAML frontmatter:

```markdown
---
name: my-command
description: What this command does
allowed-tools: [Bash, Read, Edit]
user-invocable: true
context: inline
---

## Command Prompt

Your detailed prompt here. Use $ARGUMENTS to reference user input after the command.

Example: /my-command arg1 arg2
```

### Frontmatter Fields

| Field | Type | Description |
|-------|------|-------------|
| `name` | string | Command name |
| `description` | string | Shown in help and auto-complete |
| `allowed-tools` | string[] | Tools the skill can use |
| `user-invocable` | boolean | Allow `/command-name` invocation |
| `context` | `inline` \| `fork` | Inline = in conversation, Fork = sub-agent |
| `arguments` | string[] | Expected argument names |

## Creating a Custom Command

When the user asks to create a custom command:

1. **Understand the requirement** — what should the command do?
2. **Generate the content** — write the prompt with appropriate tools and context
3. **Save to** `~/.claude/commands/<command-name>.md`
4. **Confirm** the command is ready to use

## Output Format

After generating the command, output:
1. The file path: `~/.claude/commands/<command-name>.md`
2. The complete content
3. Confirmation that the command is ready to use
