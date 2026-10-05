import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdir, mkdtemp, symlink, writeFile, rm } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import {
  ModValidationError,
  validateEntryPath,
  validateModImports,
  validateModSize,
} from './validate.js'

let dir: string

beforeEach(async () => {
  dir = await mkdtemp(join(tmpdir(), 'opencc-mods-validate-'))
})

afterEach(async () => {
  await rm(dir, { recursive: true, force: true })
})

async function writeModRoot(
  files: Record<string, string>,
  modRoot = join(dir, 'my-mod'),
): Promise<string> {
  for (const [rel, content] of Object.entries(files)) {
    const abs = join(modRoot, rel)
    await mkdir(join(abs, '..'), { recursive: true })
    await writeFile(abs, content)
  }
  return modRoot
}

describe('validateEntryPath', () => {
  test('accepts a plain relative .js entry', async () => {
    const modRoot = await writeModRoot({
      'mods/register.js': 'export function register() {}',
    })
    const entry = await validateEntryPath('my-mod', modRoot, './mods/register.js')
    expect(entry).toEndWith('register.js')
  })

  test('rejects non-.js/.mjs extensions', async () => {
    const modRoot = await writeModRoot({
      'mods/register.ts': 'export function register() {}',
    })
    expect(
      validateEntryPath('my-mod', modRoot, './mods/register.ts'),
    ).rejects.toThrow(ModValidationError)
  })

  test('rejects missing entry', async () => {
    const modRoot = await writeModRoot({})
    expect(
      validateEntryPath('my-mod', modRoot, './mods/register.js'),
    ).rejects.toThrow(ModValidationError)
  })

  test('rejects .. traversal outside the mod root', async () => {
    const outside = join(dir, 'outside.js')
    await writeFile(outside, 'export {}')
    const modRoot = join(dir, 'traversal-mod')
    await mkdir(modRoot, { recursive: true })
    expect(
      validateEntryPath('my-mod', modRoot, '../outside.js'),
    ).rejects.toThrow(/outside the mod folder/)
  })

  test('rejects symlinked entry escaping the mod root', async () => {
    const outside = join(dir, 'outside.js')
    await writeFile(outside, 'export {}')
    const modRoot = await writeModRoot({})
    await mkdir(join(modRoot, 'mods'), { recursive: true })
    await symlink(outside, join(modRoot, 'mods', 'register.js'))
    expect(
      validateEntryPath('my-mod', modRoot, './mods/register.js'),
    ).rejects.toThrow(/outside the mod folder/)
  })
})

describe('validateModSize', () => {
  test('accepts a small mod', async () => {
    const modRoot = await writeModRoot({
      'mods/register.js': 'export function register() {}',
    })
    await expect(validateModSize('my-mod', modRoot)).resolves.toBeUndefined()
  })

  test('rejects files over 1MB', async () => {
    const big = 'x'.repeat(1_000_001)
    const modRoot = await writeModRoot({ 'mods/big.js': big })
    expect(validateModSize('my-mod', modRoot)).rejects.toThrow(/1MB/)
  })
})

describe('validateModImports', () => {
  test('allows relative imports', async () => {
    const modRoot = await writeModRoot({
      'mods/register.js':
        "import { helper } from './lib/util.js'\nexport function register() {}",
      'mods/lib/util.js': 'export const helper = 1',
    })
    await expect(
      validateModImports('my-mod', modRoot),
    ).resolves.toBeUndefined()
  })

  test('rejects bare npm specifiers', async () => {
    const modRoot = await writeModRoot({
      'mods/register.js':
        "import { z } from 'zod'\nexport function register() {}",
    })
    expect(validateModImports('my-mod', modRoot)).rejects.toThrow(
      /bare module specifier "zod"/,
    )
  })

  test('rejects node: builtins', async () => {
    const modRoot = await writeModRoot({
      'mods/register.js':
        "import { readFile } from 'node:fs/promises'\nexport function register() {}",
    })
    expect(validateModImports('my-mod', modRoot)).rejects.toThrow(
      /bare module specifier "node:fs\/promises"/,
    )
  })

  test('rejects dynamic import of bare specifier', async () => {
    const modRoot = await writeModRoot({
      'mods/register.js':
        "export async function register() { await import('somewhere') }",
    })
    expect(validateModImports('my-mod', modRoot)).rejects.toThrow(
      /bare module specifier "somewhere"/,
    )
  })
})
