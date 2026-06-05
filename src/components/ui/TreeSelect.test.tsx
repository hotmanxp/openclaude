import { describe, expect, test } from 'bun:test';
import * as M from './TreeSelect.js';

describe('TreeSelect (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
