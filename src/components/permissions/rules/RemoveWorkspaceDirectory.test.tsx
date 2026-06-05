import { describe, expect, test } from 'bun:test';
import * as M from './RemoveWorkspaceDirectory.js';

describe('RemoveWorkspaceDirectory (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
