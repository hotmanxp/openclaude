import { mkdtempSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
process.env.CLAUDE_CONFIG_DIR = mkdtempSync(join(tmpdir(),'judge-cc009-'))
const { setClaudeConfigHomeDirForTesting } = await import('/Users/ethan/code/opencc/src/utils/envUtils.js')
setClaudeConfigHomeDirForTesting(process.env.CLAUDE_CONFIG_DIR)
// import tools.js FIRST so the AgentTool<->tools cycle resolves in the right order
const T = await import('/Users/ethan/code/opencc/src/tools.js')
const { resolveAgentTools } = await import('/Users/ethan/code/opencc/src/tools/AgentTool/agentToolUtils.js')
const { getCoordinatorAgents } = await import('/Users/ethan/code/opencc/src/coordinator/workerAgent.js')
const CM = await import('/Users/ethan/code/opencc/src/coordinator/coordinatorMode.js')
const S = await import('/Users/ethan/code/opencc/src/utils/settings/settings.js')
process.env.NODE_ENV='test'

const workerDef = getCoordinatorAgents().find(a => a.agentType === 'worker')!
const permCtx = { mode: 'acceptEdits' } as any
console.log('WORKER_AGENT.tools =', JSON.stringify(workerDef.tools))

for (const simple of [undefined, '1']) {
  if (simple) process.env.CLAUDE_CODE_SIMPLE = simple; else delete process.env.CLAUDE_CODE_SIMPLE
  S.updateSettingsForSource('userSettings', { coordinatorMode: true })
  console.log(`\n===== CLAUDE_CODE_SIMPLE=${simple ?? '(unset)'} isCoordinatorMode=${CM.isCoordinatorMode()} =====`)
  const pool = T.assembleToolPool(permCtx, [])
  console.log('parent pool =', JSON.stringify(pool.map(t=>t.name)))
  const r = resolveAgentTools(workerDef, pool, true)   // AgentTool.tsx:691 isAsync
  console.log('WORKER resolved =', JSON.stringify(r.resolvedTools.map(t=>t.name)))
  console.log('WORKER COUNT =', r.resolvedTools.length)
  console.log('PROMPT claims :', CM.getCoordinatorUserContext([]).workerToolsContext)
  const sp = CM.getCoordinatorSystemPrompt()
  console.log('SYSPROMPT line :', sp.split('\n').filter(l=>l.includes('Workers have access'))[0])
}
