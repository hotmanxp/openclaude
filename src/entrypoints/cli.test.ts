// @ts-nocheck
/**
 * Regression tests for issue #402 — NODE_OPTIONS heap cap
 * Closes: hotmanxp/opencc#402 — JavaScript heap OOM during large tasks
 */

import { describe, it, expect, beforeAll, afterAll, beforeEach, afterEach } from 'bun:test'
import { copyFile, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join, resolve } from 'node:path'
import { pathToFileURL } from 'node:url'

describe('cli.tsx — NODE_OPTIONS --max-old-space-size (issue #402)', () => {
  const originalNodeOptions = process.env.NODE_OPTIONS

  beforeEach(() => {
    delete process.env.NODE_OPTIONS
  })

  afterEach(() => {
    if (originalNodeOptions !== undefined) {
      process.env.NODE_OPTIONS = originalNodeOptions
    } else {
      delete process.env.NODE_OPTIONS
    }
  })

  it('sets --max-old-space-size=8192 when NODE_OPTIONS is not set', () => {
    // Guard predicate: fires when the flag is absent
    const shouldSetHeapCap = !process.env.NODE_OPTIONS?.includes('--max-old-space-size')
    expect(shouldSetHeapCap).toBe(true)
  })

  it('does not override existing --max-old-space-size=4096', () => {
    process.env.NODE_OPTIONS = '--max-old-space-size=4096 --experimental-vm-modules'

    const shouldSetHeapCap = !process.env.NODE_OPTIONS.includes('--max-old-space-size')
    expect(shouldSetHeapCap).toBe(false)
    expect(process.env.NODE_OPTIONS).toContain('4096')
  })

  it('does not override existing --max-old-space-size=8192', () => {
    process.env.NODE_OPTIONS = '--max-old-space-size=8192'

    const shouldSetHeapCap = !process.env.NODE_OPTIONS.includes('--max-old-space-size')
    expect(shouldSetHeapCap).toBe(false)
    expect(process.env.NODE_OPTIONS).toBe('--max-old-space-size=8192')
  })

  it('appends --max-old-space-size when NODE_OPTIONS has other flags', () => {
    process.env.NODE_OPTIONS = '--inspect=9229'

    const result = `${process.env.NODE_OPTIONS} --max-old-space-size=8192`
    expect(result).toBe('--inspect=9229 --max-old-space-size=8192')
  })
})

describe('useMemoryUsage.ts — threshold constants (issue #402)', () => {
  it('HIGH_MEMORY_THRESHOLD documented as 1.5 GB', async () => {
    const src = await Bun.file(
      `${import.meta.dir}/../hooks/useMemoryUsage.ts`,
    ).text()

    expect(src).toContain('HIGH_MEMORY_THRESHOLD = 1.5 * 1024 * 1024 * 1024')
  })

  it('CRITICAL_MEMORY_THRESHOLD documented as 2.5 GB', async () => {
    const src = await Bun.file(
      `${import.meta.dir}/../hooks/useMemoryUsage.ts`,
    ).text()

    expect(src).toContain('CRITICAL_MEMORY_THRESHOLD = 2.5 * 1024 * 1024 * 1024')
  })
})

describe('Node 24 premature exit regression (issue #1678)', () => {
  let buildDir: string

  beforeAll(async () => {
    const repoRoot = resolve(import.meta.dir, '../..')
    buildDir = await mkdtemp(join(tmpdir(), 'opencc-startup-test-'))
    // Build the current source privately, in a throwaway directory. Unit tests
    // must not depend on a missing or stale repository dist bundle — the
    // previous version of this test pointed at ../../dist/cli.mjs and failed
    // outright whenever the repository had not been built.
    for (const directory of ['src', 'scripts', 'node_modules']) {
      await symlink(join(repoRoot, directory), join(buildDir, directory), 'junction')
    }
    for (const file of ['package.json', 'tsconfig.json']) {
      await copyFile(join(repoRoot, file), join(buildDir, file))
    }
    const build = Bun.spawn([process.execPath, 'run', 'scripts/build.ts'], {
      cwd: buildDir,
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 120_000,
    })
    const [exitCode, stdout, stderr] = await Promise.all([
      build.exited,
      new Response(build.stdout).text(),
      new Response(build.stderr).text(),
    ])
    if (exitCode !== 0) {
      throw new Error(`CLI build failed (${exitCode}):\n${stdout}\n${stderr}`)
    }
  }, 130_000) // Leave time beyond the build deadline for output and cleanup.

  afterAll(async () => {
    if (buildDir) await rm(buildDir, { recursive: true, force: true })
  })

  it('built CLI stays alive during initialization in interactive mode without premature exit', async () => {
    const scriptPath = join(buildDir, 'startup.mjs')
    const cliUrl = pathToFileURL(join(buildDir, 'dist/cli.mjs')).href
    await Bun.write(scriptPath, `
        // Mock TTY so the CLI thinks it's interactive and starts the TUI
        process.stdout.isTTY = true;
        process.stdin.isTTY = true;
        process.stdin.setRawMode = () => {};
        process.stdin.ref = () => process.stdin;
        process.stdin.unref = () => process.stdin;
        // If the entrypoint uses void main(), this promise resolves immediately.
        // If it correctly uses await main(), it stays pending while the CLI runs.
        import(${JSON.stringify(cliUrl)}).then(() => {
          console.log('---PREMATURE_EVAL_END---');
          process.exit(0);
        });
      `)

    // Deliberately supply only the environment needed by this interactive
    // fixture. Parent provider settings, CI, and auto-run guards must not
    // change startup, and no real user/project configuration should be read.
    // HOME points at the throwaway build dir, so the CLI's global config
    // (~/.claude.json and friends) is written inside it and removed with it.
    const proc = Bun.spawn(['node', scriptPath], {
      cwd: buildDir,
      env: {
        PATH: process.env.PATH,
        TMPDIR: tmpdir(),
        TEMP: tmpdir(),
        TMP: tmpdir(),
        HOME: buildDir,
        USERPROFILE: buildDir,
        OPENCC_CONFIG_DIR: join(buildDir, 'config'),
        CLAUDE_CONFIG_DIR: join(buildDir, 'config'),
        OPENCLAUDE_CONFIG_DIR: join(buildDir, 'config'),
        XDG_CONFIG_HOME: join(buildDir, 'config'),
        XDG_CACHE_HOME: join(buildDir, 'cache'),
        NODE_COMPILE_CACHE: join(buildDir, 'cache'),
        DISABLE_TELEMETRY: '1',
        OPENGATEWAY_API_KEY: 'dummy',
      },
      stdin: 'pipe',
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 8_000,
    })
    let stdout = ''
    let stderr = ''
    async function capture(stream: ReadableStream<Uint8Array>, append: (text: string) => void) {
      const reader = stream.getReader()
      const decoder = new TextDecoder()
      try {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          append(decoder.decode(value, { stream: true }))
        }
        append(decoder.decode())
      } finally {
        reader.releaseLock()
      }
    }
    const output = Promise.all([
      capture(proc.stdout, text => { stdout += text }),
      capture(proc.stderr, text => { stderr += text }),
    ])

    try {
      // Wait for the real startup banner, a premature evaluation, or an exit.
      const deadline = Date.now() + 7_000
      while (!stdout.includes('Welcome') &&
        !stdout.includes('---PREMATURE_EVAL_END---') &&
        proc.exitCode === null && Date.now() < deadline) {
        await new Promise(r => setTimeout(r, 10))
      }
      if (!stdout.includes('Welcome')) {
        throw new Error(`CLI did not reach startup (exit ${proc.exitCode}):\n${stdout}\n${stderr}`)
      }

      // The critical regression window: wait 500ms *after* output.
      // With void main(), Node 24 will exit during the subsequent async imports because the event loop empties,
      // which allows the import() promise above to resolve and emit the signal.
      await new Promise(r => setTimeout(r, 500))

      expect(stdout).not.toContain('---PREMATURE_EVAL_END---')
      expect(proc.exitCode, `CLI exited during initialization:\n${stderr}`).toBe(null)
      expect(proc.killed).toBe(false)
    } finally {
      if (proc.exitCode === null) proc.kill('SIGKILL')
      await proc.exited
      await output
    }
  }, 10_000) // Leave time beyond the eight-second child deadline for cleanup.

  it('cli.tsx uses top-level await for main() to prevent premature exit', async () => {
    const src = await Bun.file(`${import.meta.dir}/cli.tsx`).text()
    expect(src).toMatch(/await main\(\)/)
    expect(src).not.toMatch(/^\s*void main\(\)/m)
  })
})
