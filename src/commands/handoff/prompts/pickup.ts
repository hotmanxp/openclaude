export interface PickupPromptInput {
  pickPath: string | null
  pickContent: string | null
  errorNote: string | null
  cwd: string
  root: string
  availableFiles: string[]
}

export async function renderPickupPrompt(
  input: PickupPromptInput,
): Promise<string> {
  const { pickPath, pickContent, errorNote, cwd } = input

  const warningBlock = errorNote
    ? `## ⚠️ Warning

${errorNote}

**Do not** give up. Use **AskUserQuestion** to ask the user:
- the actual handoff file path (could be from another project, copied elsewhere, or hand-written)
- or instruct the user to run /handon in another session to generate one
`
    : ''

  const preReadBlock = pickPath
    ? `## Pre-read handoff

Path: \`${pickPath}\`

\`\`\`markdown
${pickContent ?? '(failed to read)'}
\`\`\`
`
    : ''

  return `# Task: Resume from a handoff document

${warningBlock}${preReadBlock}## Resume flow

1. **${errorNote ? 'Once you have the correct path,' : ''} Read the handoff document in full with the Read tool**
2. **Re-activate the previously useful skills** — scan the doc's \`## Skills Used\` section and re-invoke each listed skill with the **Skill** tool (e.g. \`Skill(skill: "commit", ...)\`). Skills don't persist across sessions; without re-invoking them, the next-step guidance from each skill is missing.
3. **Restore the TaskList using TaskCreate / TaskUpdate**
4. **Verify cwd, dependencies, and intermediate artifacts are in place**
5. **Tell the user:** "Resumed \`<task>\`. Current progress: X. Next step: Y. Continue?"

## cwd

\`\`\`
${cwd}
\`\`\`
`
}
