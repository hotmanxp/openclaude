// Genuine SIGKILL mid-write: no simulation of the syscall, just an actual
// kill of an actual fs.writeFile.
import { spawn } from 'child_process'
import { readFileSync, writeFileSync, statSync } from 'fs'

const path = '/tmp/bughunt-claude-code/probe-tasks/victim.json'
// Pre-existing good task file (the previous committed state)
const good = JSON.stringify({ id: '1', subject: 'good state', status: 'in_progress' }, null, 2)
writeFileSync(path, good)
console.log('pre-kill size =', statSync(path).size, 'bytes, content:', JSON.stringify(readFileSync(path,'utf8')))

const child = spawn('bun', ['/tmp/bughunt-claude-code/probe-tasks/child-write.mjs', path], { stdio: 'ignore' })
// let it get into the write, then kill -9
await new Promise(r => setTimeout(r, 400))
child.kill('SIGKILL')
await new Promise(r => child.on('exit', r))

const after = readFileSync(path, 'utf8')
console.log('post-kill size =', statSync(path).size, 'bytes')
console.log('post-kill content:', JSON.stringify(after.slice(0, 80)))
console.log('contains previous good state?', after.includes('good state') ? 'YES' : 'NO — destroyed')
console.log('is it valid JSON?', (() => { try { JSON.parse(after); return 'yes' } catch { return 'NO — truncated/corrupt' } })())