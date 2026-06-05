import { describe, expect, test } from 'bun:test';
import * as M from './KeybindingProviderSetup.js';

describe('KeybindingProviderSetup (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
