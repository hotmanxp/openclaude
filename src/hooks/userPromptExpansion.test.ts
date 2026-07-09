import { describe, expect, test } from 'bun:test';
import type { Command } from '../types/command.js';
import {
  USER_PROMPT_EXPANSION_HOOK_EVENT,
  invokeUserPromptExpansionHook,
} from './userPromptExpansion.js';

const stubCmd = (): Command =>
  ({ name: 'foo', type: 'local', description: 'foo' } as unknown as Command);

describe('invokeUserPromptExpansionHook stub', () => {
  test('always returns undefined (allow) by default', async () => {
    const result = await invokeUserPromptExpansionHook({
      command: stubCmd(),
      args: 'arbitrary user input',
    });
    expect(result).toBeUndefined();
  });

  test('returns undefined even with empty args', async () => {
    const result = await invokeUserPromptExpansionHook({
      command: stubCmd(),
      args: '',
    });
    expect(result).toBeUndefined();
  });

  test('event constant matches upstream v2.1.201 name', () => {
    expect(USER_PROMPT_EXPANSION_HOOK_EVENT).toBe('UserPromptExpansion');
  });

  // TODO(legacy-2026-07-04-stacked-skill): wire when OpenCC adds
  // UserPromptExpansion as a registered hook event type. Until then,
  // real-hook dispatch is out of scope; the no-op stub is correct.
  test.skip('dispatches to configured hook chain when UserPromptExpansion is registered (future)', async () => {
    // Future test body:
    //   1. Stub appSettings with a hook list.
    //   2. Call invokeUserPromptExpansionHook with a known command.
    //   3. Assert the hook runner was called and produced {blocked:true}.
  });
});
