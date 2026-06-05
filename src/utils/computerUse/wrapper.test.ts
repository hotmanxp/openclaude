import { describe, expect, test } from 'bun:test';
import * as M from './wrapper.js';

describe('wrapper (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
