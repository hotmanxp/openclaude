import type { LocalJSXCommandCall } from '../../types/command.js'
import type { BuiltinModSpec } from '../builtin.js'

/**
 * Built-in `skill-doctor` mod — which loaded skills went unused and what they
 * cost in context.
 *
 * The host used to own `/skill-doctor` (src/commands/skill-doctor, upstream
 * 2.1.270) as a `local-jsx` command; this mod takes the bare name the same
 * way the diff mod took /diff and the handoff mod took /handoff.
 *
 * The view lives in ./skillDoctorView.tsx and is imported dynamically inside
 * `call`, never at module scope — `mods/builtin.ts` imports this file to
 * declare its fixed manifest, so a static Ink import would re-enter it
 * mid-evaluation and throw a TDZ error.
 */

export const skillDoctorCall: LocalJSXCommandCall = async (
  onDone,
  _context,
  _args,
) => {
  // Loaded here rather than at module scope for the same reason the view is:
  // `getSkillToolCommands` lives in commands.ts, which imports the mods
  // engine to build its command list — a static import would close that cycle.
  const [{ getSkillToolCommands }, { getCwd }, { SkillDoctorReport }] =
    await Promise.all([
      import('../../commands.js'),
      import('../../utils/cwd.js'),
      import('./skillDoctorView.js'),
    ])

  const skills = await getSkillToolCommands(getCwd())
  // Dismissal is the view's Esc → onCancel → onDone. Nothing here queries the
  // model, so onDone carries no display/message — same contract as the
  // handoff mod's empty-state dialog.
  return <SkillDoctorReport skills={skills} onCancel={() => onDone()} />
}

export const skillDoctorBuiltinMod: BuiltinModSpec = {
  name: 'skill-doctor',
  version: '1.0.0',
  description:
    '已加载技能的使用情况与上下文开销，用于判断哪些技能该清理',
  register(ctx): void {
    ctx.registerCommand({
      name: 'skill-doctor',
      type: 'local-jsx',
      description: '查看已加载技能的使用率与上下文开销，便于清理闲置技能',
      call: skillDoctorCall,
    })
  },
}