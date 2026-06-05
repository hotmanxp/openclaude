// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import * as M from './MCPAgentServerMenu.js';

describe('MCPAgentServerMenu (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
