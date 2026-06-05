import { describe, expect, test } from 'bun:test';
import * as M from './execPromptHook.js';

describe('execPromptHook (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
