import { describe, expect, test } from 'bun:test';
import * as M from './Config.js';

describe('Config (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
