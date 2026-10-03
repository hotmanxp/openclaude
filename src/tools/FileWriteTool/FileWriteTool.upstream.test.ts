import { afterEach, beforeEach, describe, expect, test } from 'bun:test'
import { mkdtempSync, mkdirSync, symlinkSync, writeFileSync } from 'fs'
import { tmpdir } from 'os'
import { join } from 'path'
import { FileWriteTool } from './FileWriteTool.js'
import { getEmptyToolPermissionContext } from '../../Tool.js'

// Minimal ToolUseContext stand-in: validateInput only touches
// readFileState, getAppState().toolPermissionContext, and agentId.
function makeContext(opts?: {
  permissionContext?: ReturnType<typeof getEmptyToolPermissionContext>
  agentId?: string
  readFileState?: Map<string, unknown>
}) {
  const permissionContext =
    opts?.permissionContext ?? getEmptyToolPermissionContext()
  return {
    agentId: opts?.agentId,
    getAppState: () => ({ toolPermissionContext: permissionContext }),
    readFileState: {
      get: (p: string) => opts?.readFileState?.get(p),
    },
  } as unknown as Parameters<
    NonNullable<typeof FileWriteTool.validateInput>
  >[1]
}

let dir: string
beforeEach(() => {
  dir = mkdtempSync(join(tmpdir(), 'write-upstream-'))
})
afterEach(() => {
  // best-effort cleanup; tmpdir will be reaped by the OS
})

describe('FileWriteTool validateInput — upstream 2.1.287 additions', () => {
  test('errorCode 2: null byte in file_path', async () => {
    const res = await FileWriteTool.validateInput!(
      { file_path: `${dir}/bad\0name.txt`, content: 'x' } as never,
      makeContext(),
    )
    expect(res).toMatchObject({ result: false, errorCode: 2 })
    expect((res as { message: string }).message).toContain(
      'cannot contain null bytes',
    )
  })

  test('errorCode 5: subagent writing a REPORT.md', async () => {
    const res = await FileWriteTool.validateInput!(
      { file_path: `${dir}/REPORT.md`, content: '# findings' } as never,
      makeContext({ agentId: 'agent-1' }),
    )
    expect(res).toMatchObject({ result: false, errorCode: 5 })
    expect((res as { message: string }).message).toContain(
      'Subagents should return findings as text',
    )
  })

  test('errorCode 5 does not fire for a non-subagent', async () => {
    const res = await FileWriteTool.validateInput!(
      { file_path: `${dir}/REPORT.md`, content: '# findings' } as never,
      makeContext(),
    )
    // No agentId → the md-report guard is skipped. The file does not exist,
    // so the normal flow ENOENTs out to `result: true` (creating a new file
    // needs no prior Read). The point is that errorCode 5 is NOT raised.
    expect(res).not.toMatchObject({ errorCode: 5 })
    expect(res).toMatchObject({ result: true })
  })

  test('errorCode 5 guard is agentId-gated, not path-gated', async () => {
    // A subagent writing a non-report filename is allowed through.
    const res = await FileWriteTool.validateInput!(
      { file_path: `${dir}/notes.txt`, content: 'x' } as never,
      makeContext({ agentId: 'agent-1' }),
    )
    expect(res).not.toMatchObject({ errorCode: 5 })
  })

  test('errorCode 17: file_path names a directory', async () => {
    mkdirSync(join(dir, 'subdir'))
    const res = await FileWriteTool.validateInput!(
      { file_path: `${dir}/subdir`, content: 'x' } as never,
      makeContext(),
    )
    expect(res).toMatchObject({ result: false, errorCode: 17 })
    expect((res as { message: string }).message).toContain(
      'is a directory, not a file',
    )
  })

  test('errorCode 18: file_path is a FIFO', async () => {
    // mkfifo is not exposed by node's fs; a symlink is covered by
    // checkPermissions, so assert the non-regular-file branch via a
    // directory-shaped non-file instead: /dev/null is a char device.
    const res = await FileWriteTool.validateInput!(
      { file_path: '/dev/null', content: 'x' } as never,
      makeContext({
        readFileState: new Map([
          ['/dev/null', { content: '', timestamp: Number.MAX_SAFE_INTEGER }],
        ]),
      }),
    )
    expect(res).toMatchObject({ result: false, errorCode: 18 })
    expect((res as { message: string }).message).toContain(
      'not a regular file',
    )
  })
})

describe('FileWriteTool checkPermissions — symlink refusal', () => {
  test('refuses to write through a symlink and names the target', async () => {
    const target = join(dir, 'real.txt')
    writeFileSync(target, 'original')
    const link = join(dir, 'link.txt')
    symlinkSync(target, link)

    const decision = await FileWriteTool.checkPermissions!(
      { file_path: link, content: 'overwritten' } as never,
      makeContext(),
    )
    expect(decision).toMatchObject({ behavior: 'deny' })
    expect((decision as { message: string }).message).toContain(
      'it is a symbolic link',
    )
    expect((decision as { message: string }).message).toContain(target)
  })

  test('allows a regular file (symlink guard does not false-positive)', async () => {
    const target = join(dir, 'plain.txt')
    writeFileSync(target, 'x')
    const decision = await FileWriteTool.checkPermissions!(
      { file_path: target, content: 'y' } as never,
      makeContext(),
    )
    // Either a normal allow/ask/deny from the permission system — the point
    // is it is NOT the symlink refusal.
    expect((decision as { message?: string }).message ?? '').not.toContain(
      'symbolic link',
    )
  })
})

describe('FileWriteTool metadata — upstream 2.1.287', () => {
  test('carries the new ToolDef fields', () => {
    expect(FileWriteTool.ruleContentField).toBe('file_path')
    expect(FileWriteTool.backgrounding).toBe('never')
    expect(FileWriteTool.remoteExecution).toEqual({
      supported: true,
      decidingInputFields: ['file_path', 'content'],
    })
    expect(typeof FileWriteTool.stripForStorage).toBe('function')
    expect(typeof FileWriteTool.fromAnotherProcess).toBe('function')
    expect(typeof FileWriteTool.outputSchemaAcrossProcesses).toBe('function')
    expect(FileWriteTool.coerceInputBeforePluginHooks).toBe(true)
  })

  test('outputSchema exposes userModified and staged', () => {
    const shape = FileWriteTool.outputSchema.shape as Record<string, unknown>
    expect(Object.keys(shape)).toContain('userModified')
    expect(Object.keys(shape)).toContain('staged')
  })

  test('stripForStorage blanks content/originalFile on a real update', () => {
    const stripped = FileWriteTool.stripForStorage!({
      type: 'update',
      filePath: '/p',
      content: 'a'.repeat(1000),
      originalFile: 'b'.repeat(1000),
      structuredPatch: [{ oldStart: 1, oldLines: 1, newStart: 1, newLines: 1, lines: ['x'] }],
    } as never) as { content: string; originalFile: null }
    expect(stripped.content).toBe('')
    expect(stripped.originalFile).toBeNull()
  })

  test('stripForStorage leaves a create untouched', () => {
    const created = {
      type: 'create' as const,
      filePath: '/p',
      content: 'hello',
      structuredPatch: [],
      originalFile: null,
    }
    expect(FileWriteTool.stripForStorage!(created as never)).toEqual(created)
  })
})

describe('FileWriteTool mapToolResultToToolResultBlockParam', () => {
  const base = {
    filePath: '/p/f.txt',
    content: 'x',
    structuredPatch: [],
    originalFile: null,
  }

  test('create without userModified', () => {
    const block = FileWriteTool.mapToolResultToToolResultBlockParam(
      { ...base, type: 'create' } as never,
      'tu1',
    )
    expect(block.content).toBe('File created successfully at: /p/f.txt')
  })

  test('create with userModified folds the note into the same sentence', () => {
    const block = FileWriteTool.mapToolResultToToolResultBlockParam(
      { ...base, type: 'create', userModified: true } as never,
      'tu1',
    )
    // Upstream's note carries its own leading space; the create sentence has
    // no trailing period, so the join reads "…/f.txt The user modified…".
    expect(block.content).toBe(
      'File created successfully at: /p/f.txt The user modified your proposed content before accepting it.',
    )
  })

  test('update with userModified', () => {
    const block = FileWriteTool.mapToolResultToToolResultBlockParam(
      { ...base, type: 'update', originalFile: 'y', userModified: true } as never,
      'tu1',
    )
    expect(block.content).toBe(
      'The file /p/f.txt has been updated successfully. The user modified your proposed content before accepting it.',
    )
  })
})

describe('FileWriteTool coerceInput', () => {
  test('normalizes path/file_text aliases', () => {
    const out = FileWriteTool.coerceInput!({
      path: '/p/f.txt',
      file_text: 'body',
      description: 'ignored',
    } as never)
    expect(out).not.toBeNull()
    expect(out!.input).toMatchObject({ file_path: '/p/f.txt', content: 'body' })
    expect(out!.input).not.toHaveProperty('path')
    expect(out!.input).not.toHaveProperty('file_text')
    expect(out!.input).not.toHaveProperty('description')
  })

  test('returns null when required fields are absent', () => {
    expect(FileWriteTool.coerceInput!({ nope: 1 } as never)).toBeNull()
    expect(FileWriteTool.coerceInput!(null as never)).toBeNull()
  })
})
