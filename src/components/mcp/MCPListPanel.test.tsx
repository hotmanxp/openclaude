// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import * as M from './MCPListPanel.js';

describe('MCPListPanel (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
