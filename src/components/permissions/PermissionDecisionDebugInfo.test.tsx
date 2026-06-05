import { describe, expect, test } from 'bun:test';
import * as M from './PermissionDecisionDebugInfo.js';

describe('PermissionDecisionDebugInfo (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
