import { describe, expect, test } from 'bun:test';
import * as M from './Fallback.js';

describe('Fallback (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
