import { describe, expect, test } from 'bun:test'
import { writeFileSync, mkdtempSync, rmSync } from 'fs'
import { join } from 'path'
import { tmpdir } from 'os'
import { spawnSync } from 'child_process'

const SCRIPT = join(import.meta.dir, 'check-feature-solidify.ts')

describe('check-feature-solidify', () => {
  test.skip('passes when src/ has no feature() for any true flag (TODO: open after all waves)', () => {
    const result = spawnSync('bun', [SCRIPT], { encoding: 'utf-8' })
    expect(result.status).toBe(0)
  })

  test('fails when src/ contains feature("HISTORY_SNIP") (true flag in dict)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'check-fs-'))
    writeFileSync(join(tmp, 'fake.ts'), `if (feature('HISTORY_SNIP')) { console.log('a') }\n`)
    const result = spawnSync('bun', [SCRIPT, '--src', tmp], { encoding: 'utf-8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/HISTORY_SNIP/)
    rmSync(tmp, { recursive: true })
  })

  test('does NOT flag VOICE_MODE (false flag, allowed)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'check-fs-'))
    writeFileSync(join(tmp, 'a.ts'), `if (feature('VOICE_MODE')) { console.log('a') }\n`)
    const result = spawnSync('bun', [SCRIPT, '--src', tmp], { encoding: 'utf-8' })
    expect(result.status).toBe(0)
    rmSync(tmp, { recursive: true })
  })

  test('flags multi-line feature(\'HISTORY_SNIP\')', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'check-fs-'))
    writeFileSync(join(tmp, 'multi.ts'), `feature(\n  'HISTORY_SNIP',\n)\n`)
    const result = spawnSync('bun', [SCRIPT, '--src', tmp], { encoding: 'utf-8' })
    expect(result.status).toBe(1)
    expect(result.stdout).toMatch(/HISTORY_SNIP/)
    rmSync(tmp, { recursive: true })
  })

  test('does NOT flag KAIROS_BRIEF (not in dict)', () => {
    const tmp = mkdtempSync(join(tmpdir(), 'check-fs-'))
    writeFileSync(join(tmp, 'k.ts'), `if (feature('KAIROS_BRIEF')) {}\n`)
    const result = spawnSync('bun', [SCRIPT, '--src', tmp], { encoding: 'utf-8' })
    expect(result.status).toBe(0)
    rmSync(tmp, { recursive: true })
  })
})