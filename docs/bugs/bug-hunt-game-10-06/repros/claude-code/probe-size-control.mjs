// Size-cap control: same 1.5MB content, once as a plain file (should be
// rejected), once behind a symlink (should also be rejected, but isn't).
import { mkdir, writeFile, symlink, rm, stat } from 'node:fs/promises'
import { validateModSize } from '/Users/ethan/code/opencc/src/mods/validate.ts'

const BIG = 'x'.repeat(1_500_000)
const root = '/tmp/bughunt-claude-code/fakemod2'

// --- control: plain regular file over the 1MB cap -------------------------
await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })
await writeFile(root + '/big.mjs', BIG)
console.log('[control] plain file size:', (await stat(root + '/big.mjs')).size)
try {
  await validateModSize('m', root)
  console.log('[control] plain 1.5MB: NOT rejected  <-- unexpected')
} catch (e) {
  console.log('[control] plain 1.5MB REJECTED:', e.message)
}

// --- test: identical bytes, reached through a symlink ---------------------
await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })
const outside = '/tmp/bughunt-claude-code/outside2.mjs'
await writeFile(outside, BIG)
await symlink(outside, root + '/big.mjs')
console.log('[test]    symlinked file size:', (await stat(root + '/big.mjs')).size)
try {
  await validateModSize('m', root)
  console.log('[test]    symlinked 1.5MB: NOT rejected  <-- cap bypassed, guard at validate.ts:104-119 is dead')
} catch (e) {
  console.log('[test]    symlinked 1.5MB REJECTED:', e.message)
}
