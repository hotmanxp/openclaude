import { describe, expect, test } from 'bun:test';
import { deriveFirstPrompt } from './branch.js';

describe('branch (smoke)', () => {
  test('deriveFirstPrompt is callable and does not throw on weak input', () => {
    expect(deriveFirstPrompt).toBeDefined();
    expect(() => deriveFirstPrompt(undefined)).not.toThrow();
    expect(typeof deriveFirstPrompt(undefined)).toBe('string');
  });
});
