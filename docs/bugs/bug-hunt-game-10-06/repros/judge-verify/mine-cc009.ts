process.env.CLAUDE_CONFIG_DIR = (await import('node:fs')).mkdtempSync((await import('node:path')).join((await import('node:os')).tmpdir(),'judge-cc009-'))
const { setClaudeConfigHomeDirForTesting } = await import('/Users/ethan/code/opencc/src/utils/envUtils.js')
setClaudeConfigHomeDirForTesting(process.env.CLAUDE_CONFIG_DIR)

const { resolveAgentTools } = await import('/Users/ethan/code/opencc/src/tools/AgentTool/agentToolUtils.js')
const { getCoordinatorAgents } = await import('/Users/ethan/code/opencc/src/coordinator/workerAgent.js')
const { getTools, assembleToolPool } = await import('/Users/ethan/code/opencc/src/tools.js')
const { isCoordinatorMode, getCoordinatorUserContext, getCoordinatorSystemPrompt } =
  await import('/Users/ethan/code/opencc/src/coordinator/coordinatorMode.js')

const workerDef = getCoordinatorAgents().find(a => a.agentType === 'worker')!
const permCtx = { mode: 'acceptEdits' } as any

for (const simple of [undefined, '1']) {
  if (simple) process.env.CLAUDE_CODE_SIMPLE = simple
  else delete process.env.CLAUDE_CODE_SIMPLE
  // coordinator mode must be ON for the worker branch; simulate via settings
  const S = await import('/Users/ethan/code/opencc/src/utils/settings/settings.js')
  S.updateSettingsForSource('userSettings', { coordinatorMode: true })
  console.log(`\n===== CLAUDE_CODE_SIMPLE=${simple ?? '(unset)'}  isCoordinatorMode=${isCoordinatorMode()} =====`)
  console.log('WORKER_AGENT.tools =', JSON.stringify(workerDef.tools))
  const pool = assembleToolPool(permCtx, [])
  console.log('parent pool (assembleToolPool) =', JSON.stringify(pool.map(t=>t.name)))
  // non-fork path in AgentTool.tsx:763/843 uses assembleToolPool as availableTools
  const r = resolveAgentTools(workerDef, pool, true)
  console.log('WORKER resolved tools (isAsync=true) =', JSON.stringify(r.resolvedTools.map(t=>t.name)))
  console.log('WORKER tool COUNT =', r.resolvedTools.length)
  const ctx = getCoordinatorUserContext([])
  console.log('PROMPT says       :', ctx.workerToolsContext)
}
