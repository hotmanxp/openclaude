import { expect, test } from 'bun:test'
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'

const runnerPath = join(import.meta.dir, 'run-tests.ts')

/**
 * Run the shard runner over one throwaway test file and report its exit code
 * plus the tail of its output.
 */
async function runRunner(
  body: string,
  extraArgs: string[] = [],
): Promise<{ code: number; output: string }> {
  const root = mkdtempSync(join(tmpdir(), 'opencc-runner-test-'))
  const testFile = join(root, 'sample.test.ts')
  writeFileSync(testFile, body)
  try {
    const child = Bun.spawn({
      cmd: [process.execPath, runnerPath, ...extraArgs, testFile],
      cwd: process.cwd(),
      stdin: 'ignore',
      stdout: 'pipe',
      stderr: 'pipe',
      timeout: 60_000,
      killSignal: process.platform === 'win32' ? undefined : 'SIGKILL',
    })
    const [code, stdout, stderr] = await Promise.all([
      child.exited,
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
    ])
    return { code, output: `${stdout}\n${stderr}` }
  } finally {
    rmSync(root, { recursive: true, force: true })
  }
}

test('never asks bun for per-file isolation', async () => {
  // --isolate/--parallel give every file a fresh global object. Suites in this
  // repository depend on shared in-process state (SDK permission-callback IPC
  // timing, the subprocess wait in runAutoFixCheck, corrupted-config recovery)
  // and a full run hangs on openclaudePaths.test.ts under those flags.
  const source = await Bun.file(runnerPath).text()
  const command = source.match(/const child = Bun\.spawn\(\[([\s\S]*?)\], \{/)?.[1] ?? ''
  expect(command).not.toBe('')
  expect(command).not.toContain('--isolate')
  expect(command).not.toContain('--parallel')
  expect(command).toContain('--reporter=junit')
})

test('reports success for a passing suite', async () => {
  const { code, output } = await runRunner(
    `import { expect, test } from 'bun:test'\ntest('passes', () => { expect(1).toBe(1) })\n`,
  )
  expect(output, output).toMatch(/Finished test shard 1\/1/)
  expect(code).toBe(0)
})

test('reports failure for a failing suite', async () => {
  const { code, output } = await runRunner(
    `import { expect, test } from 'bun:test'\ntest('fails', () => { expect(1).toBe(2) })\n`,
  )
  expect(output, output).toContain('(fail)')
  expect(code).toBe(1)
})

test('kills a shard that exceeds its deadline', async () => {
  const { code, output } = await runRunner(
    `import { expect, test } from 'bun:test'\ntest('hangs', async () => { await new Promise(r => setTimeout(r, 30_000)); expect(1).toBe(1) })\n`,
    ['--shard-timeout-ms=1000'],
  )
  expect(output, output).toContain('timed out after 1000ms')
  expect(code).toBe(124)
})
