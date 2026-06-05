// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import * as M from './MCPSettings.js';

describe('MCPSettings (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
