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

/**
 * Rendered by skillDoctorMod.tsx, never at module scope.
 *
 * `mods/builtin.ts` imports the mod to declare its fixed manifest, so
 * anything the mod imports statically has to finish evaluating before
 * `skillDoctorBuiltinMod` exists. An Ink component reached from the
 * component tree re-enters `mods/builtin.ts` mid-evaluation and throws
 * "Cannot access 'skillDoctorBuiltinMod' before initialization" — the same
 * cycle `handoffMod.tsx` breaks by importing its picker dynamically.
 */
import type { ReactNode } from 'react'
import { Dialog } from '../../components/design-system/Dialog.js'
import { Box, Text } from '../../ink.js'
import type { Command } from '../../types/command.js'

/** Name + description is what the model actually sees in its tool list. */
function estimateTokens(skill: Command): number {
  return Math.ceil(
    (skill.name.length + (skill.description?.length ?? 0)) / 4,
  )
}

export function SkillDoctorReport({
  skills,
  onCancel,
}: {
  skills: Command[]
  onCancel: () => void
}): ReactNode {
  const rows = skills.map(skill => ({
    name: skill.name,
    desc: skill.description,
    tokens: estimateTokens(skill),
  }))

  return (
    <Dialog
      title="/skill-doctor"
      subtitle={`已加载技能 ${rows.length} 个 · 每项上下文开销为粗略估算（仅名称 + 描述）`}
      // Esc, via Dialog's built-in `confirm:no` binding. The report is
      // read-only, so there is nothing to confirm — a dialog whose default
      // guide advertises "Enter confirm" would promise a key that does
      // nothing, so the guide is replaced rather than left to lie.
      onCancel={onCancel}
      color="claude"
      inputGuide={() => <Text dimColor>Esc 关闭</Text>}
    >
      {rows.length === 0 ? (
        <Text dimColor>当前会话没有加载任何技能。</Text>
      ) : (
        <Box flexDirection="column">
          {rows.map(r => (
            <Box key={r.name} flexDirection="column">
              <Text>
                • {r.name} <Text dimColor>(~{r.tokens} tokens)</Text>
              </Text>
              {r.desc ? <Text dimColor>  {r.desc}</Text> : null}
            </Box>
          ))}
        </Box>
      )}
    </Dialog>
  )
}