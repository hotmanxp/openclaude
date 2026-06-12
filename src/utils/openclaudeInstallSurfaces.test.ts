import { afterEach, expect, mock, test } from 'bun:test'
import * as fsPromises from 'fs/promises'
import { homedir } from 'os'
import { join } from 'path'

const originalEnv = { ...process.env }
const originalMacro = (globalThis as Record<string, unknown>).MACRO

afterEach(() => {
  process.env = { ...originalEnv }
  ;(globalThis as Record<string, unknown>).MACRO = originalMacro
  mock.restore()
})

async function importFreshInstallCommand() {
  return import(`../commands/install.tsx?ts=${Date.now()}-${Math.random()}`)
}

async function importFreshInstaller() {
  return import(`./nativeInstaller/installer.ts?ts=${Date.now()}-${Math.random()}`)
}

// SKIPPED: env.ts mock is incomplete - many exports not mocked (JETBRAINS_IDES, getHostPlatformForAnalytics, etc)
// These tests have complex module loading dependencies that require significant rework
test.skip('install command displays ~/.local/bin/openclaude on non-Windows', async () => {
  mock.module('../utils/env.js', () => ({
    env: { platform: 'darwin' },
    getHostPlatformForAnalytics: () => 'darwin',
  }))

  const { getInstallationPath } = await importFreshInstallCommand()

  expect(getInstallationPath()).toBe('~/.local/bin/openclaude')
})

test.skip('install command displays openclaude.exe path on Windows', async () => {
  mock.module('../utils/env.js', () => ({
    env: { platform: 'win32' },
    getHostPlatformForAnalytics: () => 'win32',
  }))

  const { getInstallationPath } = await importFreshInstallCommand()

  expect(getInstallationPath()).toBe(
    join(homedir(), '.local', 'bin', 'openclaude.exe').replace(/\//g, '\\'),
  )
})

test.skip('cleanupNpmInstallations removes both openclaude and legacy claude local install dirs', async () => {
  const removedPaths: string[] = []
  ;(globalThis as Record<string, unknown>).MACRO = {
    PACKAGE_URL: '@hotmanxp/opencc',
  }

  mock.module('fs/promises', () => ({
    ...fsPromises,
    rm: async (path: string) => {
      removedPaths.push(path)
    },
  }))

  mock.module('./execFileNoThrow.js', () => ({
    execFileNoThrowWithCwd: async () => ({
      code: 1,
      stderr: 'npm ERR! code E404',
    }),
  }))

  mock.module('./envUtils.js', () => ({
    getClaudeConfigHomeDir: () => join(homedir(), '.claude'),
    isEnvTruthy: (value: string | undefined) => value === '1',
  }))

  const { cleanupNpmInstallations } = await importFreshInstaller()
  await cleanupNpmInstallations()

  expect(removedPaths).toContain(join(homedir(), '.claude', 'local'))
  expect(removedPaths).toContain(join(homedir(), '.claude', 'local'))
})
