import { describe, expect, test } from 'bun:test';
import { PermissionRuleInput } from './PermissionRuleInput.js';

describe('PermissionRuleInput (render smoke)', () => {
  test('exports a callable component', () => {
    expect(PermissionRuleInput).toBeDefined();
  });
});
