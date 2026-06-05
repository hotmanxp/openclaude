import { describe, expect, test } from 'bun:test';
import * as M from './FlashingChar.js';

describe('FlashingChar (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
