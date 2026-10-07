// cc-003: in listModFiles' walk(), `if (!entry.isFile()) continue` runs BEFORE
// the symlink-escape check. Node's Dirent.isFile() is FALSE for a symlink
// (even one pointing at a regular file), so a symlinked mod file is skipped
// before the check runs — the escape check is unreachable, and the file is
// omitted from the list that feeds validateModSize / validateModImports.
import { mkdtempSync, mkdirSync, writeFileSync, symlinkSync, rmSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { readdirSync, lstatSync } from 'fs'

const d = mkdtempSync(join(tmpdir(),'cc003-'))
const modRoot = join(d, 'mod')
mkdirSync(modRoot, { recursive: true })
const outside = join(d, 'outside')
mkdirSync(outside, { recursive: true })
writeFileSync(join(outside, 'huge.mjs'), 'x'.repeat(3 * 1024 * 1024))
symlinkSync(join(outside, 'huge.mjs'), join(modRoot, 'linked.mjs'))
symlinkSync('/etc/passwd', join(modRoot, 'etcpasswd.mjs'))

const entries = readdirSync(modRoot, { withFileTypes: true })
console.log('entries in mod root:')
for (const e of entries) {
  console.log(`  ${e.name.padEnd(14)} isFile=${e.isFile()} isSymbolicLink=${e.isSymbolicLink()}`)
}
const fileEntries = entries.filter(e => e.isFile())
console.log(`\nentries passing \`!entry.isFile()\` continue: ${fileEntries.length} of ${entries.length}`)
console.log(fileEntries.length === 0
  ? 'RESULT: REPRODUCED — every symlink is skipped before the escape check;\n' +
    '        the file never enters the list, so size/import limits skip it too.'
  : 'RESULT: symlinks reach the check')
rmSync(d, { recursive: true, force: true })
process.exit(0)
