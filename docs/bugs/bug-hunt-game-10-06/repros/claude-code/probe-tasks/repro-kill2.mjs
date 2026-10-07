// Kill the writer the instant the file is observed non-empty but short.
// No timing guess — poll the size and SIGKILL at the truncation window.
import { spawn } from 'child_process'
import { readFileSync, writeFileSync, statSync } from 'fs'

const path = '/tmp/bughunt-claude-code/probe-tasks/victim.json'
const good = JSON.stringify({ id: '1', subject: 'good state', status: 'in_progress' }, null, 2)
writeFileSync(path, good)
console.log('pre-kill :', statSync(path).size, 'bytes ->', JSON.stringify(readFileSync(path, 'utf8')))

const child = spawn('bun', ['/tmp/bughunt-claude-code/probe-tasks/child-write2.mjs', path], { stdio: 'ignore' })

let caught = false
for (let i = 0; i < 2_000_000; i++) {
  let sz = -1
  try { sz = statSync(path).size } catch {}
  if (sz > 0 && sz < good.length + 1000) {
    child.kill('SIGKILL')
    caught = true
    console.log('SIGKILL delivered while file was', sz, 'bytes (partial)')
    break
  }
}
await new Promise(r => child.on('exit', r))
if (!caught) { console.log('kill window not observed; file completed'); process.exit(0) }

const after = readFileSync(path, 'utf8')
console.log('post-kill:', statSync(path).size, 'bytes ->', JSON.stringify(after.slice(0, 60)))
console.log('previous good state still present?', after.includes('good state') ? 'YES' : 'NO — DESTROYED by truncate')
console.log('valid JSON?', (() => { try { JSON.parse(after); return 'yes' } catch { return 'NO — corrupt' } })())