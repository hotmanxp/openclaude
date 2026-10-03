import { describe, expect, test } from 'bun:test';
import { FileEditTool } from './FileEditTool.js';

describe('FileEditTool description', () => {
  // Upstream 2.1.177 shipped "Performs exact string replacements in files.";
  // 2.1.287 shortened it to "A tool for editing files" (bundle @11750271).
  test('matches upstream 2.1.287 one-liner', async () => {
    const description = await (
      FileEditTool.description as unknown as () => Promise<string>
    )();
    expect(description).toBe('A tool for editing files');
  });
});

describe('FileEditTool metadata — upstream 2.1.287', () => {
  test('carries the new ToolDef fields', () => {
    expect(FileEditTool.ruleContentField).toBe('file_path');
    expect(FileEditTool.backgrounding).toBe('never');
    expect(FileEditTool.remoteExecution).toEqual({
      supported: true,
      decidingInputFields: [
        'file_path',
        'old_string',
        'new_string',
        'replace_all',
      ],
    });
    expect(typeof FileEditTool.stripForStorage).toBe('function');
    expect(typeof FileEditTool.fromAnotherProcess).toBe('function');
    expect(typeof FileEditTool.outputSchemaAcrossProcesses).toBe('function');
    expect(typeof FileEditTool.coerceInput).toBe('function');
  });

  test('outputSchema exposes the new upstream fields', () => {
    const shape = FileEditTool.outputSchema.shape as Record<string, unknown>;
    expect(Object.keys(shape)).toContain('staleRecovered');
    expect(Object.keys(shape)).toContain('contentNotInModelContext');
    expect(Object.keys(shape)).toContain('staged');
  });

  test('stripForStorage blanks a non-empty originalFile only', () => {
    const withContent = FileEditTool.stripForStorage!({
      filePath: '/p',
      oldString: 'a',
      newString: 'b',
      originalFile: 'a'.repeat(500),
      structuredPatch: [],
      userModified: false,
      replaceAll: false,
    } as never) as { originalFile: string };
    expect(withContent.originalFile).toBe('');

    const alreadyBlank = {
      filePath: '/p',
      oldString: 'a',
      newString: 'b',
      originalFile: '',
      structuredPatch: [],
      userModified: false,
      replaceAll: false,
    };
    expect(FileEditTool.stripForStorage!(alreadyBlank as never)).toEqual(
      alreadyBlank,
    );
  });

  test('coerceInput normalizes the Rtn alias table', () => {
    const out = FileEditTool.coerceInput!({
      path: '/p/f.ts',
      old_str: 'a',
      new_str: 'b',
      replace_name: true,
    } as never);
    expect(out).not.toBeNull();
    expect(out!.input).toMatchObject({
      file_path: '/p/f.ts',
      old_string: 'a',
      new_string: 'b',
      replace_all: true,
    });
    for (const gone of ['path', 'old_str', 'new_str', 'replace_name']) {
      expect(out!.input).not.toHaveProperty(gone);
    }
  });

  test('coerceInput returns null when a required field is missing', () => {
    expect(
      FileEditTool.coerceInput!({ path: '/p', old_str: 'a' } as never),
    ).toBeNull();
  });
});

describe('FileEditTool mapToolResultToToolResultBlockParam', () => {
  const base = {
    filePath: '/p/f.txt',
    oldString: 'a',
    newString: 'b',
    originalFile: 'x',
    structuredPatch: [],
    userModified: false,
    replaceAll: false,
  }

  test('staleRecovered explains the edit landed on a drifted file', () => {
    const block = FileEditTool.mapToolResultToToolResultBlockParam(
      { ...base, staleRecovered: true } as never,
      'tu1',
    )
    expect(block.content).toContain(
      'the file had been modified on disk since you last read it',
    )
    expect(block.content).toContain('the edit applied cleanly')
  })

  test('no stale note when the file did not drift', () => {
    const block = FileEditTool.mapToolResultToToolResultBlockParam(
      base as never,
      'tu1',
    )
    expect(block.content).not.toContain('the edit applied cleanly')
    expect(block.content).toBe(
      'The file /p/f.txt has been updated successfully.',
    )
  })

  test('staged overrides the success copy entirely', () => {
    const block = FileEditTool.mapToolResultToToolResultBlockParam(
      { ...base, staged: true, stagedWording: 'card' } as never,
      'tu1',
    )
    expect(block.content).toContain('was NOT modified')
    expect(block.content).toContain('permission card')
    expect(block.content).not.toContain('has been updated')
  })
})
