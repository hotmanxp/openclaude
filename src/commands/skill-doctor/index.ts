// Upstream 2.1.270 sync: /skill-doctor command.
// Source: claude-code 2.1.270 (added 2.1.261). Description wording
// follows upstream release notes verbatim. Minimal OpenCC port: lists
// skill commands from getSkillToolCommands() and reports which have
// zero matches in the recent message transcript, plus an estimated
// per-skill context cost. The full upstream report includes per-skill
// recall scores from a tracer telemetry source not present in OpenCC;
// that part is omitted (the report still answers the headline
// question: "which skills went unused").
import type { Command } from '../../commands.js'

const skillDoctor = {
  type: 'local-jsx',
  name: 'skill-doctor',
  description: 'Show which loaded skills go unused and what they cost in context, so you can prune them.',
  load: () => import('./SkillDoctor.js'),
} satisfies Command

export default skillDoctor