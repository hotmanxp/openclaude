import { describe, expect, test } from 'bun:test';
import * as M from './speculation.js';

describe('speculation (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
