import { describe, expect, test } from 'bun:test';
import * as M from './SandboxOverridesTab.js';

describe('SandboxOverridesTab (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
