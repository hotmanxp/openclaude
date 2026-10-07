// oc-002: /mods reload re-imported the mod entry, but ESM caches a module by
// resolved URL forever — so editing a mod's source and reloading kept running
// the OLD code. The reload reported success and nothing changed.
//
// Run with NODE, not bun:
//   node docs/bugs/.../probe-oc002-reload-stale.mjs
// Bun's ESM loader ignores the ?query cache-buster on file: URLs, so under bun
// this prints V1 every time regardless of the fix. The shipped runtime is Node
// (package.json engines.node >= 22; Bun is only the build/test toolchain), so
// Node is what has to work — and does.
import { mkdtempSync, writeFileSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { pathToFileURL } from 'node:url'

const dir = mkdtempSync(join(tmpdir(), 'oc002-'))
const entry = join(dir, 'register.mjs')
const write = v =>
  writeFileSync(
    entry,
    `export function register() { return '${v}' }\nexport const MARKER = '${v}'\n`,
  )

write('V1')
const first = await import(pathToFileURL(entry).href + '?openccReload=1')
console.log('first load  :', first.MARKER)

write('V2')
const second = await import(pathToFileURL(entry).href + '?openccReload=2')
console.log('after edit  :', second.MARKER)

console.log('\n===== RESULT =====')
console.log(
  second.MARKER === 'V2'
    ? 'NOT REPRODUCED: each load pass gets a distinct specifier, so edited mod code runs.'
    : 'REPRODUCED: the cached module was reused and the edit was ignored.',
)
rmSync(dir, { recursive: true, force: true })
process.exit(second.MARKER === 'V2' ? 0 : 1)
