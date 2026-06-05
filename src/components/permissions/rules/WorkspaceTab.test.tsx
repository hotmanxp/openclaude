import { describe, expect, test } from 'bun:test';
import * as M from './WorkspaceTab.js';

describe('WorkspaceTab (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
