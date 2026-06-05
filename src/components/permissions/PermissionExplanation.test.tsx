import { describe, expect, test } from 'bun:test';
import * as M from './PermissionExplanation.js';

describe('PermissionExplanation (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
