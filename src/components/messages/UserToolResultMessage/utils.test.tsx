import { describe, expect, test } from 'bun:test';
import * as M from './utils.js';

describe('utils (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
