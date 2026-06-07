// Extract the list of skills invoked in this session by scanning
// `Skill` tool_use blocks across all messages. Deduped, insertion order
// preserved (first invocation wins).
export function extractSkillsUsed(messages: ReadonlyArray<unknown>): string[] {
  const seen = new Set<string>()
  const out: string[] = []
  for (const msg of messages) {
    const m = msg as {
      message?: {
        content?:
          | string
          | Array<{ type: string; name?: string; input?: unknown }>
      }
    }
    const content = m.message?.content
    if (!Array.isArray(content)) continue
    for (const block of content) {
      if (block.type === 'tool_use' && block.name === 'Skill') {
        const input = block.input as { skill?: string } | undefined
        const name = input?.skill
        if (name && !seen.has(name)) {
          seen.add(name)
          out.push(name)
        }
      }
    }
  }
  return out
}
