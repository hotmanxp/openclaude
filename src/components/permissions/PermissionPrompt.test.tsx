import { describe, expect, test } from 'bun:test';
import * as M from './PermissionPrompt.js';

describe('PermissionPrompt (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
