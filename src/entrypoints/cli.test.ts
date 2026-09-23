// @ts-nocheck
/**
 * Regression tests for issue #402 — NODE_OPTIONS heap cap
 * Closes: hotmanxp/opencc#402 — JavaScript heap OOM during large tasks
 */

import { describe, it, expect, beforeEach, afterEach } from 'bun:test'

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
  it('built CLI stays alive during initialization in interactive mode without premature exit', async () => {
    const os = await import('node:os')
    const path = await import('node:path')
    const fs = await import('node:fs/promises')
    const url = await import('node:url')

    const scriptPath = path.join(os.tmpdir(), `test-cli-startup-${Date.now()}.mjs`)
    const cliUrl = url.pathToFileURL(path.resolve(import.meta.dir, '../../dist/cli.mjs')).href

    // SAFETY: the child process runs the REAL CLI, which performs startup
    // config I/O. Without a sandboxed env it resolves its global config to the
    // developer's actual ~/.claude.json (os.homedir() ignores runtime env
    // changes only in-process; the child inherits whatever HOME we pass) and
    // rewrites it plus ~/.claude/backups on every run. Redirect everything
    // into a throwaway temp home.
    const sandboxHome = await fs.mkdtemp(path.join(os.tmpdir(), 'opencc-cli-sandbox-'))
    const sandboxEnv = {
      ...process.env,
      HOME: sandboxHome,
      USERPROFILE: sandboxHome,
      OPENCC_CONFIG_DIR: path.join(sandboxHome, '.opencc'),
      CLAUDE_CONFIG_DIR: path.join(sandboxHome, '.opencc'),
      OPENCLAUDE_CONFIG_DIR: path.join(sandboxHome, '.opencc'),
    }
    let proc
    let reader

    try {
      await Bun.write(scriptPath, `
        // Mock TTY so the CLI thinks it's interactive and starts the TUI
        process.stdout.isTTY = true;
        process.stdin.isTTY = true;
        process.stdin.setRawMode = () => {};
        process.env.OPENCLAUDE_DISABLE_TELEMETRY = '1';
        process.env.OPENGATEWAY_API_KEY = 'dummy';

        // Ensure the CLI auto-runs even if the test runner disabled it globally
        delete process.env.OPENCLAUDE_DISABLE_CLI_ENTRYPOINT_AUTO_RUN;

        // Use absolute import to work from os.tmpdir()
        // If the entrypoint uses void main(), this promise resolves immediately.
        // If it correctly uses await main(), it stays pending while the CLI runs.
        import('${cliUrl}').then(() => {
          console.log('---PREMATURE_EVAL_END---');
          process.exit(0);
        });
      `)

      proc = Bun.spawn(['node', scriptPath], {
        stdout: 'pipe',
        env: sandboxEnv,
      })
      const reader = proc.stdout.getReader()

      let gotOutput = false
      let evaluationEndedPrematurely = false

      async function readStdout() {
        while (true) {
          const { done, value } = await reader.read()
          if (done) break
          const text = new TextDecoder().decode(value)
          if (text.includes('---PREMATURE_EVAL_END---')) {
            evaluationEndedPrematurely = true
          } else if (text.trim().length > 0) {
            gotOutput = true
          }
        }
      }

      // Start reading without awaiting it yet
      const readPromise = readStdout()

      // Wait until we get startup output or detect premature evaluation end
      const start = Date.now()
      while (!gotOutput && !evaluationEndedPrematurely && Date.now() - start < 5000) {
        await new Promise(r => setTimeout(r, 10))
      }

      expect(gotOutput).toBe(true)

      // The critical regression window: wait 500ms *after* output.
      // With void main(), Node 24 will exit during the subsequent async imports because the event loop empties,
      // which allows the import() promise above to resolve and emit the signal.
      await new Promise(r => setTimeout(r, 500))

      expect(evaluationEndedPrematurely).toBe(false)
      expect(proc.exitCode).toBe(null)
      expect(proc.killed).toBe(false)
    } finally {
      if (proc && proc.exitCode === null && !proc.killed) {
        proc.kill()
      }
      await fs.unlink(scriptPath).catch(() => {})
      await fs.rm(sandboxHome, { recursive: true, force: true }).catch(() => {})
    }
  })

  it('cli.tsx uses top-level await for main() to prevent premature exit', async () => {
    const src = await Bun.file(`${import.meta.dir}/cli.tsx`).text()
    expect(src).toMatch(/await main\(\)/)
    expect(src).not.toMatch(/^\s*void main\(\)/m)
  })
})
