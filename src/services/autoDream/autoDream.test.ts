import { describe, expect, test } from 'bun:test';
import * as M from './autoDream.js';

describe('autoDream (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
