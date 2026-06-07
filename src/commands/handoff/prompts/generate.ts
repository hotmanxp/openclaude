import type { TaskStatus, TaskType } from '../../../Task.js'

export interface TaskListEntry {
  id: string
  type: TaskType
  status: TaskStatus
  description: string
}

export interface GeneratePromptInput {
  cwd: string
  root: string
  today: string
  messageCount: number
  taskList: TaskListEntry[]
  skillsUsed: string[]
}

export async function renderGeneratePrompt(
  input: GeneratePromptInput,
): Promise<string> {
  const { cwd, today, messageCount, taskList, skillsUsed } = input

  const taskListBlock = taskList.length
    ? taskList
        .map(t => `- [${t.status}] #${t.id} ${t.type} ${t.description}`)
        .join('\n')
    : '(empty)'

  const skillsBlock = skillsUsed.length
    ? skillsUsed.map(s => `- \`${s}\``).join('\n')
    : '(none)'

  return `# Task: Generate a handoff document for the current session

You are generating a handoff document for the next session. **Do not** reply directly to the user — write the file with the **Bash** tool.

## Output path

\`\`\`
<project>/.agent_working_dir/handoff/<task>-${today}.md
\`\`\`

- \`<project>\`: current cwd (see below)
- \`<task>\`: a kebab-case task slug YOU generate based on the core goal of this session (≤ 30 chars, **English**, unambiguous)
- \`<YYYY-MM-DD>\`: \`${today}\`
- If a file with the same name already exists, append \`-2\` / \`-3\` ...

## Context

- cwd: \`${cwd}\`
- messageCount: \`${messageCount}\`
- current TaskList:
\`\`\`
${taskListBlock}
\`\`\`
- skills used in this session (extracted from \`Skill\` tool calls):
\`\`\`
${skillsBlock}
\`\`\`

## Document structure (write in this order)

1. **# Task title** — one-line summary
2. **## Original Request** — the user's first request, verbatim or distilled
3. **## Goal** — completion condition (verifiable)
4. **## Artifacts** — files / plans / specs / code / commits produced in this session (with paths or commit hashes)
5. **## Key Findings** — non-obvious conclusions
6. **## Pitfalls** — failed attempts, root causes, fixes (so the next session doesn't repeat them)
7. **## Current TaskList** — full copy of the task list above (status + type + description)
8. **## Next Steps** — where the next session should start, what's still open
9. **## Skills Used** — list the skills (from the context above) that were relevant to this task, with a one-line note per skill on how it was used (skip if none)

## Writing rules

- Use English, clear and concise, max 5 short paragraphs per section
- Use paths **relative to cwd**
- Task slug must be semantic (e.g. \`add-handoff-command\`, NOT \`task-12345\`)
- After writing, run \`ls -la \`<dir>\`\` to confirm the file exists on disk
- Finish with a single line to the user: "✅ Handoff document written: \`<path>\`"

Start now.
`
}
