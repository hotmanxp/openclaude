import { describe, expect, test } from 'bun:test';
import * as M from './PermissionRuleDescription.js';

describe('PermissionRuleDescription (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
