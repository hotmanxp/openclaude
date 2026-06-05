import { describe, expect, test } from 'bun:test';
import * as M from './Usage.js';

describe('Usage (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
