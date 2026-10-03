import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
// GlobTool/UI.tsx imports GrepTool at module scope, so GrepTool must be
// initialised first or the cycle trips on the TDZ.
import '../GlobTool/GlobTool.js'
import { GrepTool } from './GrepTool.js'

/**
 * End-to-end Grep checks against a real ripgrep binary.
 *
 * `rg` on this machine is a shell alias, so a shim directory is put on PATH
 * for the duration of the run. Without a resolvable binary these skip.
 */
const VENDORED =
  '/Users/ethan/code/opencc-web/packages/zn-agent-core/vendor/ripgrep/rg-darwin-arm64'

function resolveRipgrep(): string | null {
  if (process.env.RIPGREP_BIN && existsSync(process.env.RIPGREP_BIN)) {
    return process.env.RIPGREP_BIN
  }
  try {
    execFileSync('rg', ['--version'], { stdio: 'ignore' })
    return 'rg'
  } catch {
    return existsSync(VENDORED) ? VENDORED : null
  }
}

const RG = resolveRipgrep()
if (RG && RG !== 'rg') {
  const shim = join(tmpdir(), 'rg-shim-bin')
  mkdirSync(shim, { recursive: true })
  const link = join(shim, 'rg')
  if (!existsSync(link)) {
    try {
      require('fs').symlinkSync(RG, link)
    } catch {}
  }
  process.env.PATH = `${shim}:${process.env.PATH ?? ''}`
}

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rg-grep-'))
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

async function runGrep(dir: string, input: Record<string, unknown>) {
  const controller = new AbortController()
  const result = await GrepTool.call(
    { pattern: 'needle', path: dir, ...input } as never,
    {
      abortController: controller,
      getAppState: () => ({ toolPermissionContext: { read: [] } }),
    } as never,
  )
  return result.data as {
    mode: string
    content?: string
    filenames?: string[]
    numFiles: number
    numMatches?: number
  }
}

const describeRg = RG ? describe : describe.skip

describeRg('GrepTool content mode via --json', () => {
  test('returns match lines with line numbers', async () => {
    const dir = makeRepo({ 'a.txt': 'first needle line\nsecond line\n' })
    const data = await runGrep(dir, { output_mode: 'content' })
    expect(data.mode).toBe('content')
    expect(data.content).toContain('first needle line')
    expect(data.content).toMatch(/a\.txt:1:/)
  })

  test('a long line is replaced with a marker, not silently clipped', async () => {
    const dir = makeRepo({
      'long.txt': `${'a'.repeat(600)}needle\n`,
    })
    const data = await runGrep(dir, { output_mode: 'content' })
    expect(data.content).toContain('[Omitted long matching line]')
  })

  test('context rows are separated from non-contiguous blocks', async () => {
    const lines = ['needle', 'x', 'y', 'z', 'needle'].join('\n') + '\n'
    const dir = makeRepo({ 'c.txt': lines })
    const data = await runGrep(dir, { output_mode: 'content', '-A': 1 })
    expect(data.content).toContain('x')
    // The gap between the two needles must be visible, not silently elided.
    expect(data.content).toContain('--')
  })

  test('-o returns only the matched text', async () => {
    const dir = makeRepo({ 'a.txt': 'say needle now\n' })
    const data = await runGrep(dir, { output_mode: 'content', '-o': true })
    expect(data.content).toContain('needle')
    expect(data.content).not.toContain('say')
  })

  test('a match on a line carrying a NUL is not silently mangled', async () => {
    // rg's binary heuristic differs by invocation: recursively it skips the
    // file entirely, but given the path directly it reports `binary_offset` on
    // the `end` event. Either way the model must not receive a half-decoded
    // line, so assert the observable contract: either nothing, or a marker.
    const dir = makeRepo({})
    const blob = join(dir, 'blob.dat')
    writeFileSync(blob, Buffer.concat([Buffer.from('bin\0'), Buffer.from('needle '.repeat(200))]))

    const controller = new AbortController()
    const data = (await GrepTool.call(
      { pattern: 'needle', path: blob, output_mode: 'content' } as never,
      {
        abortController: controller,
        getAppState: () => ({ toolPermissionContext: { read: [] } }),
      } as never,
    ).then(r => r.data as { content: string }))

    if (data.content !== '') {
      expect(data.content).toMatch(/binary file matches|Omitted long/)
      // A NUL must never reach the model raw.
      expect(data.content).not.toContain('\0')
    }
  })
})

describeRg('GrepTool files_with_matches via --null', () => {
  test('lists matching files', async () => {
    const dir = makeRepo({ 'a.txt': 'needle\n', 'b.txt': 'nothing\n' })
    const data = await runGrep(dir, { output_mode: 'files_with_matches' })
    expect(data.numFiles).toBe(1)
    expect(data.filenames?.[0]).toContain('a.txt')
  })

  test('a filename containing a colon is not misparsed', async () => {
    const dir = makeRepo({ 'we:ird.txt': 'needle\n' })
    const data = await runGrep(dir, { output_mode: 'files_with_matches' })
    expect(data.filenames?.[0]).toContain('we:ird.txt')
  })
})

describeRg('GrepTool count mode', () => {
  test('counts matches per file', async () => {
    const dir = makeRepo({ 'a.txt': 'needle\nneedle\n' })
    const data = await runGrep(dir, { output_mode: 'count' })
    expect(data.numMatches).toBe(2)
  })

  test('single-file search still reports the path (-H)', async () => {
    const dir = makeRepo({ 'a.txt': 'needle\n' })
    const data = await runGrep(dir, { output_mode: 'count' })
    expect(data.content).toContain('a.txt')
  })
})
