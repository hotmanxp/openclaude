import { describe, expect, test } from 'bun:test';
import * as M from './PermissionRuleExplanation.js';

describe('PermissionRuleExplanation (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
