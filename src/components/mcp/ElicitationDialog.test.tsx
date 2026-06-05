// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import * as M from './ElicitationDialog.js';

describe('ElicitationDialog (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
