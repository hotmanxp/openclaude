// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import * as M from './McpParsingWarnings.js';

describe('McpParsingWarnings (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
