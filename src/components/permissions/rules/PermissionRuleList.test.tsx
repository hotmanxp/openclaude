import { describe, expect, test } from 'bun:test';
import * as M from './PermissionRuleList.js';

describe('PermissionRuleList (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
