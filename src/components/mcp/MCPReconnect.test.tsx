// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import * as M from './MCPReconnect.js';

describe('MCPReconnect (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
