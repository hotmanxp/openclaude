import { describe, expect, test } from 'bun:test';
import * as M from './RecentDenialsTab.js';

describe('RecentDenialsTab (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
