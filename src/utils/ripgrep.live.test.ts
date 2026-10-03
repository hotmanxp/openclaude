import { describe, expect, test } from 'bun:test'
import { execFileSync } from 'child_process'
import { existsSync, mkdirSync, mkdtempSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { dirname, join } from 'path'
import { fileURLToPath } from 'url'
import { ripGrep, RipgrepUsageError } from './ripgrep.js'

/**
 * Behavioural tests that need a real ripgrep binary.
 *
 * This machine's `rg` is a shell alias rather than a PATH binary, so
 * `ripGrep()` cannot find it by default. Point RIPGREP_BIN at a real binary
 * (or symlink one onto PATH) to run these; otherwise they skip.
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

function makeRepo(files: Record<string, string>): string {
  const dir = mkdtempSync(join(tmpdir(), 'rg-live-'))
  for (const [name, content] of Object.entries(files)) {
    const full = join(dir, name)
    mkdirSync(dirname(full), { recursive: true })
    writeFileSync(full, content)
  }
  return dir
}

// ripGrep resolves the binary through findExecutable('rg'), which honours
// PATH. Symlink the resolved binary so the lookup succeeds.
if (RG && RG !== 'rg') {
  const shim = join(tmpdir(), 'rg-shim-bin')
  mkdirSync(shim, { recursive: true })
  const link = join(shim, 'rg')
  if (!existsSync(link)) {
    try {
      // biome-ignore lint: test setup
      require('fs').symlinkSync(RG, link)
    } catch {}
  }
  process.env.PATH = `${shim}:${process.env.PATH ?? ''}`
}

const describeLive = RG ? describe : describe.skip

describeLive('ripGrep rejectOnInputError', () => {
  test('a malformed regex rejects instead of resolving empty', async () => {
    const dir = makeRepo({ 'a.txt': 'hello\n' })
    const controller = new AbortController()

    // Without rejectOnInputError this resolves [] — indistinguishable from
    // "no matches". That is the bug this option exists to close.
    await expect(
      ripGrep(['--files-with-matches', 'foo('], dir, controller.signal, {
        rejectOnInputError: true,
      }),
    ).rejects.toBeInstanceOf(RipgrepUsageError)
  })

  test('the rejection message tells the model the pattern was rejected', async () => {
    const dir = makeRepo({ 'a.txt': 'hello\n' })
    const controller = new AbortController()

    const err = await ripGrep(
      ['--files-with-matches', 'foo('],
      dir,
      controller.signal,
      { rejectOnInputError: true },
    ).then(
      () => null,
      (e: unknown) => e as Error,
    )

    expect(err).toBeInstanceOf(RipgrepUsageError)
    expect(err!.message).toContain('ripgrep rejected the pattern')
  })

  test('a valid regex with no matches still resolves empty', async () => {
    const dir = makeRepo({ 'a.txt': 'hello\n' })
    const controller = new AbortController()

    const result = await ripGrep(
      ['--files-with-matches', 'definitely_not_present_xyz'],
      dir,
      controller.signal,
      { rejectOnInputError: true },
    )
    expect(result).toEqual([])
  })

  test('a valid regex that matches resolves normally', async () => {
    const dir = makeRepo({ 'a.txt': 'hello world\n' })
    const controller = new AbortController()

    const result = await ripGrep(
      ['--files-with-matches', 'hello'],
      dir,
      controller.signal,
      { rejectOnInputError: true },
    )
    expect(result.length).toBe(1)
  })
})

describeLive('ripGrep rawLines', () => {
  test('a filename containing a newline survives as one record', async () => {
    const dir = makeRepo({ 'weird\nname.txt': 'x\n', 'ok.txt': 'y\n' })
    const controller = new AbortController()

    // rawLines returns stdout un-split, so the caller can split on NUL
    // instead. Newline splitting would tear this into two nonexistent paths.
    const raw = await ripGrep(
      ['--files', '--null', '--no-ignore', '--hidden'],
      dir,
      controller.signal,
      { rawLines: true },
    )
    const names = raw.join('\n').split('\0').filter(Boolean)
    expect(names.some(n => n.includes('\n'))).toBe(true)
    expect(names.some(n => n.endsWith('ok.txt'))).toBe(true)
  })

  test('rawLines keeps every record; default mode tears the newline one', async () => {
    const dir = makeRepo({ 'weird\nname.txt': 'x\n', 'ok.txt': 'y\n' })
    const controller = new AbortController()

    const rawLines = await ripGrep(
      ['--files', '--null', '--no-ignore', '--hidden'],
      dir,
      controller.signal,
      { rawLines: true },
    )
    const newlineMode = await ripGrep(
      ['--files', '--null', '--no-ignore', '--hidden'],
      dir,
      controller.signal,
    )

    // Two files on disk, so two NUL-terminated records.
    const records = rawLines.join('\n').split('\0').filter(Boolean)
    expect(records).toHaveLength(2)
    expect(records.some(p => p.endsWith('weird\nname.txt'))).toBe(true)

    // The default path split stdout on '\n' first, so the newline inside the
    // filename became a line break and then a NUL of its own — the caller
    // receives a bare 'name.txt' that is not a path in this repo.
    const shredded = newlineMode.flatMap(l => l.split('\0')).filter(Boolean)
    expect(shredded).toHaveLength(3)
    // The torn-off fragment loses its directory entirely.
    expect(shredded).toContain('name.txt')
  })
})

// Keep the import of fileURLToPath meaningful for readers tracking the vendored
// path constant above.
void fileURLToPath
