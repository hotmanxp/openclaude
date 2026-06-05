import { describe, expect, test } from 'bun:test';
import * as M from './executor.js';

describe('executor (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
