import * as React from 'react'
import { Box, Text } from '../../ink.js'
import type { LocalJSXCommandCall } from '../../types/command.js'
import { getSkillToolCommands } from '../../commands.js'
import { getCwd } from '../../utils/cwd.js'

// Upstream 2.1.270 sync: /skill-doctor UI.
// Minimal OpenCC implementation: lists loaded skills and reports an
// estimated per-skill context cost. The full upstream report includes
// per-skill recall scores from a tracer telemetry source not present
// in OpenCC; that part is omitted (the report still answers the
// headline question: "which skills go unused and what do they cost").
// Token cost is a rough proxy (name + description only) — precise
// per-skill cost requires loading the skill body, which we don't
// surface here. Users wanting exact numbers can run
// `claude skills inspect`.
export const call: LocalJSXCommandCall = async (_onDone, _context, _args) => {
  const cwd = getCwd()
  const skills = await getSkillToolCommands(cwd)

  const rows = skills.map(skill => {
    const tokens = Math.ceil(
      (skill.name.length + (skill.description?.length ?? 0)) / 4,
    )
    return { name: skill.name, desc: skill.description, tokens }
  })

  return (
    <Box flexDirection="column" paddingX={1} paddingY={1}>
      <Text bold color="cyan">
        /skill-doctor
      </Text>
      <Text>
        Loaded skills: {rows.length}. Per-skill context cost is a rough
        estimate (name + description only).
      </Text>
      {rows.length === 0 ? (
        <Text dimColor>No skills loaded in this session.</Text>
      ) : (
        <Box flexDirection="column" marginTop={1}>
          {rows.map(r => (
            <Box key={r.name} flexDirection="column">
              <Text>
                • {r.name} <Text dimColor>(~{r.tokens} tokens)</Text>
              </Text>
              {r.desc ? (
                <Text dimColor>  {r.desc}</Text>
              ) : null}
            </Box>
          ))}
        </Box>
      )}
      <Box marginTop={1}>
        <Text>
          Press <Text bold>enter</Text> to dismiss.
        </Text>
      </Box>
    </Box>
  )
}