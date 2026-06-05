import { describe, expect, test } from 'bun:test';
import * as M from './modalContext.js';

describe('modalContext (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
