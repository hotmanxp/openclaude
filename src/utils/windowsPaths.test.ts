import { afterEach, beforeEach, describe, expect, mock, spyOn, test } from 'bun:test'
import * as cwd from './cwd.js'
import * as execSyncWrapper from './execSyncWrapper.js'
import * as platform from './platform.js'
import { findGitBashPath, setShellIfWindows } from './windowsPaths.js'

describe('Windows Git Bash discovery', () => {
  const originalOverride = process.env.CLAUDE_CODE_GIT_BASH_PATH
  const originalShell = process.env.SHELL

  beforeEach(() => {
    delete process.env.CLAUDE_CODE_GIT_BASH_PATH
    findGitBashPath.cache.clear?.()
    spyOn(platform, 'getPlatform').mockReturnValue('windows')
    spyOn(console, 'error').mockImplementation(() => {})
    spyOn(process, 'exit').mockImplementation(() => {
      throw new Error('exit requested')
    })
  })

  afterEach(() => {
    mock.restore()
    findGitBashPath.cache.clear?.()
    if (originalOverride === undefined) delete process.env.CLAUDE_CODE_GIT_BASH_PATH
    else process.env.CLAUDE_CODE_GIT_BASH_PATH = originalOverride
    if (originalShell === undefined) delete process.env.SHELL
    else process.env.SHELL = originalShell
  })

  // where.exe results below a drive-root working directory must be skipped.
  // path.relative handles drive roots, where the cwd already ends in a
  // separator; a plain string prefix check does not.
  test('skips where.exe results below a drive-root working directory', () => {
    spyOn(cwd, 'getCwd').mockReturnValue('C:\\')
    // The default install locations do not exist, so only where.exe resolves.
    spyOn(execSyncWrapper, 'execSync_DEPRECATED').mockImplementation(
      ((command: string) => {
        if (command.startsWith('where.exe')) {
          return 'C:\\repo\\cmd\\git.exe\r\nD:\\Git\\cmd\\git.exe\r\n'
        }
        if (command.includes('D:\\Git\\bin\\bash.exe')) return ''
        throw new Error('not found')
      }) as unknown as typeof execSyncWrapper.execSync_DEPRECATED,
    )

    setShellIfWindows()

    // C:\repo\cmd\git.exe sits below the drive root and must be skipped, so
    // the lookup falls through to the D: drive result.
    expect(process.env.SHELL).toBe('D:\\Git\\bin\\bash.exe')
  })

  test('keeps a where.exe result outside the working directory', () => {
    spyOn(cwd, 'getCwd').mockReturnValue('C:\\workspace')
    spyOn(execSyncWrapper, 'execSync_DEPRECATED').mockImplementation(
      ((command: string) => {
        if (command.startsWith('where.exe')) {
          return 'C:\\other\\cmd\\git.exe\r\n'
        }
        if (command.includes('C:\\other\\bin\\bash.exe')) return ''
        throw new Error('not found')
      }) as unknown as typeof execSyncWrapper.execSync_DEPRECATED,
    )

    setShellIfWindows()

    expect(process.env.SHELL).toBe('C:\\other\\bin\\bash.exe')
  })
})
