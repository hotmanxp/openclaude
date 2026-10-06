// E3 repro: the symlink-escape guard in listModFiles (src/mods/validate.ts:104-119)
// is unreachable. Exercises the REAL validate.ts.
import { mkdir, writeFile, symlink, rm, stat } from 'node:fs/promises'
import { validateModSize, validateModImports } from '/Users/ethan/code/opencc/src/mods/validate.ts'

const root = '/tmp/bughunt-claude-code/fakemod'
await rm(root, { recursive: true, force: true })
await mkdir(root, { recursive: true })

// 1) Confirm Node's readdir(withFileTypes) semantics for a symlink-to-file.
const outside = '/tmp/bughunt-claude-code/outside.mjs'
await writeFile(outside, "import lodash from 'lodash'\n" + 'x'.repeat(1_500_000))
const link = root + '/linked.mjs'
await symlink(outside, link)
const { readdir } = await import('node:fs/promises')
for (const e of await readdir(root, { withFileTypes: true })) {
  console.log(`[probe] dirent "${e.name}": isFile=${e.isFile()} isSymbolicLink=${e.isSymbolicLink()}`)
}
console.log('[probe] real size of the linked target:', (await stat(link)).size, 'bytes (> 1MB cap)')

// 2) The cap that should reject it:
try {
  await validateModSize('fakemod', root)
  console.log('[probe] validateModSize: PASSED — 1.5MB file was NOT rejected (cap bypassed)')
} catch (e) {
  console.log('[probe] validateModSize rejected:', e.message)
}

// 3) The bare-specifier ban that should reject "import lodash":
try {
  await validateModImports('fakemod', root)
  console.log('[probe] validateModImports: PASSED — bare "lodash" import NOT rejected')
} catch (e) {
  console.log('[probe] validateModImports rejected:', e.message)
}

// 4) Control: the SAME content as a real (non-symlink) file IS rejected.
await rm(link)
await writeFile(root + '/plain.mjs', "import lodash from 'lodash'\n")
try {
  await validateModSize('fakemod', root)
  console.log('[probe] control(plain 1.5MB): NOT rejected')
} catch (e) {
  console.log('[probe] control(plain, over cap) rejected:', e.message)
}
await writeFile(root + '/plain.mjs', "import lodash from 'lodash'\n")
try {
  await validateModImports('fakemod', root)
  console.log('[probe] control(plain) imports: NOT rejected')
} catch (e) {
  console.log('[probe] control(plain) imports rejected:', e.message)
}
