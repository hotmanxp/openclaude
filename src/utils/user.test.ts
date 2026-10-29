// @ts-nocheck
import { afterEach, describe, expect, mock, test } from 'bun:test'

// Snapshot each real module surface into a plain object BEFORE any
// mock.module call. `import * as` gives a live namespace: mock.module
// repoints it, so restoring with the namespace itself re-installs the mock
// rather than the real module -- permanently, since mock.module lasts for the
// life of the process. That is how this suite's stderr-less `execa` stub used
// to escape into every later suite, where `result.stderr.trim()` then threw.
// A `?real=` cache-busted import resolves to a distinct module path that no
// mock.module registration can shadow, so the snapshot is the real module.
//
// The same applies to the partial mocks below: they used to expose only the
// handful of exports this suite needs, which silently removed every other
// export (getOauthAccountInfo's neighbours in auth.js, cwd.js's pwd() and
// runWithCwdOverride()) for all later test files in the process.
const nonce = `${Date.now()}-${Math.random()}`
const realAuthSnapshot = {
  ...await import(`./auth.js?real=${nonce}`),
} as typeof import('./auth.js')
const realConfigSnapshot = {
  ...await import(`./config.js?real=${nonce}`),
} as typeof import('./config.js')
const realCwdSnapshot = {
  ...await import(`./cwd.js?real=${nonce}`),
} as typeof import('./cwd.js')
const realEnvSnapshot = {
  ...await import(`./env.js?real=${nonce}`),
} as typeof import('./env.js')
const realEnvUtilsSnapshot = {
  ...await import(`./envUtils.js?real=${nonce}`),
} as typeof import('./envUtils.js')
const realExecaSnapshot = {
  ...await import(`${import.meta.resolve('execa')}?real=${nonce}`),
} as typeof import('execa')

const originalEnv = { ...process.env }
const originalMacro = (globalThis as Record<string, unknown>).MACRO

async function importFreshUserModule() {
  return import(`./user.ts?ts=${Date.now()}-${Math.random()}`)
}

async function importActualUserTestDeps() {
  const freshNonce = `${Date.now()}-${Math.random()}`
  const [authModule, configModule] = await Promise.all([
    import(`./auth.js?ts=${freshNonce}`),
    import(`./config.js?ts=${freshNonce}`),
  ])

  // execa comes from the pre-mock snapshot: a plain `import('execa')` here
  // resolves to whatever mock is currently installed, so spreading it would
  // build each new stub on top of the previous one.
  return {
    authModule,
    configModule,
    execaModule: realExecaSnapshot,
  }
}

async function installCommonMocks(options?: {
  oauthEmail?: string
  gitEmail?: string
}) {
  // NOTE: Do NOT mock ../bootstrap/state.js here.
  // mock.module() is process-global in bun:test and mock.restore() does NOT
  // undo it. Mocking state.js leaks getSessionId = () => 'session-test' into
  // every other test file that imports state.js (e.g. SDK CON-1 tests).
  // The dynamic import (importFreshUserModule) will use the real state.js,
  // which is fine — these tests only assert email, not sessionId.
  const { authModule, configModule, execaModule } = await importActualUserTestDeps()

  mock.module('./auth.js', () => ({
    ...authModule,
    getOauthAccountInfo: () =>
      options?.oauthEmail
        ? {
            emailAddress: options.oauthEmail,
            organizationUuid: 'org-test',
            accountUuid: 'acct-test',
          }
        : undefined,
    getRateLimitTier: () => null,
    getSubscriptionType: () => null,
  }))

  mock.module('./config.js', () => ({
    ...configModule,
    getGlobalConfig: () => ({}),
    getOrCreateUserID: () => 'device-test',
  }))

  mock.module('./cwd.js', () => ({
    ...realCwdSnapshot,
    getCwd: () => 'C:\\repo',
  }))

  mock.module('./env.js', () => ({
    ...realEnvSnapshot,
    env: { platform: 'windows' },
    getHostPlatformForAnalytics: () => 'windows',
  }))

  mock.module('./envUtils.js', () => ({
    ...realEnvUtilsSnapshot,
    isEnvTruthy: (value: string | undefined) =>
      !!value && value !== '0' && value.toLowerCase() !== 'false',
  }))

  mock.module('execa', () => ({
    ...execaModule,
    execa: async () => ({
      exitCode: options?.gitEmail ? 0 : 1,
      stdout: options?.gitEmail ?? '',
      stderr: '',
    }),
    execaSync: () => ({
      exitCode: 1,
      stdout: '',
      stderr: '',
      failed: true,
    }),
  }))
}

afterEach(() => {
  mock.restore()
  // mock.restore() does NOT unregister mock.module() overrides, so hand the
  // real module surfaces back to the process. Without this, this suite's
  // auth/config/cwd/env/envUtils/execa mocks stay installed for every
  // later test file of the same `bun test` run.
  mock.module('./auth.js', () => realAuthSnapshot)
  mock.module('./config.js', () => realConfigSnapshot)
  mock.module('./cwd.js', () => realCwdSnapshot)
  mock.module('./env.js', () => realEnvSnapshot)
  mock.module('./envUtils.js', () => realEnvUtilsSnapshot)
  mock.module('execa', () => realExecaSnapshot)
  process.env = { ...originalEnv }
  if (originalMacro === undefined) {
    delete (globalThis as Record<string, unknown>).MACRO
  } else {
    ;(globalThis as Record<string, unknown>).MACRO = originalMacro
  }
})

describe('user email fallbacks', () => {
  test('getCoreUserData does not synthesize Anthropic email from COO_CREATOR', async () => {
    process.env.USER_TYPE = 'ant'
    process.env.COO_CREATOR = 'alice'
    ;(globalThis as Record<string, unknown>).MACRO = { VERSION: '0.0.0' }

    await installCommonMocks()

    const { getCoreUserData } = await importFreshUserModule()
    const result = getCoreUserData()

    expect(result.email).toBeUndefined()
  })

  test('initUser falls back to git email when oauth email is missing', async () => {
    process.env.USER_TYPE = 'ant'
    process.env.COO_CREATOR = 'alice'
    ;(globalThis as Record<string, unknown>).MACRO = { VERSION: '0.0.0' }

    await installCommonMocks({ gitEmail: 'git@example.com' })

    const { initUser, getCoreUserData } = await importFreshUserModule()
    await initUser()

    const result = getCoreUserData()
    expect(result.email).toBe('git@example.com')
  })
})
