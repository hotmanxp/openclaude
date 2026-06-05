import { describe, expect, test } from 'bun:test';
import * as M from './chrome.js';

describe('chrome (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
