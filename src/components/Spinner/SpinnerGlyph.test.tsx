import { describe, expect, test } from 'bun:test';
import * as M from './SpinnerGlyph.js';

describe('SpinnerGlyph (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
