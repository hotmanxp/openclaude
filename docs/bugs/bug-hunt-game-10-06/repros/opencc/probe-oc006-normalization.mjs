// oc-006: migrateConfigFields computed normalizedConfig and then returned
// `config` on both paths, so the normalization was computed and thrown away.
import { mkdtempSync, writeFileSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
const dir = mkdtempSync(join(tmpdir(),'oc006-'))
process.env.CLAUDE_CONFIG_DIR = dir
const { setClaudeConfigHomeDirForTesting } = await import('/Users/ethan/code/opencc/src/utils/envUtils.ts')
setClaudeConfigHomeDirForTesting(dir)
const cfgmod = await import('/Users/ethan/code/opencc/src/utils/config.ts')
cfgmod.enableConfigs()
const { getGlobalConfig } = cfgmod


// Write a config with an INVALID threshold, as an older version might.
writeFileSync(join(dir,'.claude.json'), JSON.stringify({
  installMethod: 'local',           // already migrated -> early-return path
  maxMessagesCompactionThreshold: 'not-a-valid-threshold',
}))
const cfg = getGlobalConfig()
console.log('stored value :', 'not-a-valid-threshold')
console.log('after migrate:', JSON.stringify(cfg.maxMessagesCompactionThreshold))
console.log(cfg.maxMessagesCompactionThreshold === 'off'
  ? 'RESULT: normalized (invalid value coerced to "off")'
  : 'RESULT: NOT normalized — the computed config was discarded')
rmSync(dir,{recursive:true,force:true})
process.exit(0)
