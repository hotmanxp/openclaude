import { describe, expect, test } from 'bun:test';
import * as M from './ExpandShellOutputContext.js';

describe('ExpandShellOutputContext (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
