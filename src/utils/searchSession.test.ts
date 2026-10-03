import { afterEach, describe, expect, test } from 'bun:test'
import { chmod, mkdirSync, mkdtempSync, rmSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import {
  openSearchSession,
  type SearchSession,
  SearchTargetChangedError,
  toLexicalPath,
} from './searchSession.js'

const created: string[] = []

function makeRepo(files: Record<string, string> = { 'a.txt': 'x' }): string {
  const dir = mkdtempSync(join(tmpdir(), 'rg-session-'))
  created.push(dir)
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name)
    mkdirSync(join(full, '..'), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

const opened: SearchSession[] = []

async function open(target: string, approved?: string[]) {
  const s = await openSearchSession(target, approved ?? [target])
  if (s) opened.push(s)
  return s
}

afterEach(async () => {
  for (const s of opened.splice(0)) {
    await s.close().catch(() => {})
  }
  for (const dir of created.splice(0)) {
    // Restore traversal permission so rm can clean up a chmod'd fixture.
    try {
      chmodSync(dir, 0o755)
    } catch {}
    rmSync(dir, { recursive: true, force: true })
  }
})

// Minimal chmod shim (node:fs has no chmodSync named export in all versions).
function chmodSync(p: string, mode: number) {
  // biome-ignore lint: test helper
  require('fs').chmodSync(p, mode)
}

describe('openSearchSession', () => {
  test('resolves a plain directory', async () => {
    const dir = makeRepo()
    const s = await open(dir)
    expect(s).not.toBeNull()
    expect(s!.isDirectory).toBe(true)
    expect(s!.lexical).toBe(dir)
  })

  test('returns null for a path that does not exist', async () => {
    const dir = makeRepo()
    const missing = join(dir, 'nope')
    expect(await openSearchSession(missing, [missing])).toBeNull()
  })

  test('a symlink is accepted when its own spelling was approved', async () => {
    const dir = makeRepo()
    const real = join(dir, 'real')
    mkdirSync(real, { recursive: true })
    const link = join(dir, 'link')
    symlinkSync(real, link)

    // Approving the link approves the directory it points at — that is the
    // whole point of a symlinked working directory.
    const s = await open(link, [link])
    expect(s).not.toBeNull()
    expect(s!.canonical.endsWith('/real')).toBe(true)
  })

  test('recheckBeforeSpawn detects a rewritten symlink', async () => {
    const dir = makeRepo()
    const real = join(dir, 'real')
    mkdirSync(real, { recursive: true })
    writeFileSync(join(real, 'x'), 'y')

    // A second directory the link gets redirected to. The swap must change the
    // resolution: repointing the link at the SAME target would leave the
    // approved path identical, and there is nothing to detect.
    const other = join(dir, 'other')
    mkdirSync(other, { recursive: true })

    const link = join(dir, 'link')
    symlinkSync(real, link)

    const s = await open(link, [link])
    expect(s).not.toBeNull()
    expect(() => s!.recheckBeforeSpawn()).not.toThrow()

    // Redirect the link at a directory the permission check never saw.
    rmSync(link)
    symlinkSync(other, link)

    expect(() => s!.recheckBeforeSpawn()).toThrow(SearchTargetChangedError)
  })

  test('close is idempotent enough to call in a finally', async () => {
    const dir = makeRepo()
    const s = await open(dir)
    await s!.close()
    await expect(s!.close()).resolves.toBeUndefined()
  })
})

describe('toLexicalPath', () => {
  const base = {
    lexical: '/asked/path',
    canonical: '/real/path',
    spawnCwd: '/real/path',
    target: '/real/path',
    relativeOutput: false,
    isDirectory: true,
    recheckBeforeSpawn: () => {},
    recheckByPath: () => {},
    close: async () => {},
  } satisfies SearchSession

  test('rewrites a canonical prefix back to what the user asked for', () => {
    expect(toLexicalPath('/real/path/src/a.ts', base)).toBe(
      '/asked/path/src/a.ts',
    )
  })

  test('maps the directory itself back to the lexical spelling', () => {
    expect(toLexicalPath('/real/path', base)).toBe('/asked/path')
  })

  test('leaves an unrelated path untouched', () => {
    expect(toLexicalPath('/elsewhere/a.ts', base)).toBe('/elsewhere/a.ts')
  })

  test('handles a content row separator without eating the content', () => {
    expect(toLexicalPath('/real/path:12:const x = 1', base)).toBe(
      '/asked/path:12:const x = 1',
    )
  })

  test('maps relative output under a pinned descriptor', () => {
    const pinned = { ...base, relativeOutput: true, target: '.', spawnCwd: '/proc/self/fd/7' }
    expect(toLexicalPath('./src/a.ts', pinned)).toBe('/asked/path/src/a.ts')
    expect(toLexicalPath('.', pinned)).toBe('/asked/path')
  })
})
