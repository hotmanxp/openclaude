import { describe, expect, test } from 'bun:test';
import * as M from './overlayContext.js';

describe('overlayContext (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
