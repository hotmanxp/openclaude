// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import * as M from './MCPRemoteServerMenu.js';

describe('MCPRemoteServerMenu (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
