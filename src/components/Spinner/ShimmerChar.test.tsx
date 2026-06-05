import { describe, expect, test } from 'bun:test';
import * as M from './ShimmerChar.js';

describe('ShimmerChar (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
