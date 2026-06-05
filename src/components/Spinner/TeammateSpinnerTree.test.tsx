import { describe, expect, test } from 'bun:test';
import * as M from './TeammateSpinnerTree.js';

describe('TeammateSpinnerTree (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
