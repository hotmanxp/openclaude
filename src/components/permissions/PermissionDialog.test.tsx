import { describe, expect, test } from 'bun:test';
import { PermissionDialog } from './PermissionDialog.js';

describe('PermissionDialog (render smoke)', () => {
  test('exports a callable component', () => {
    expect(PermissionDialog).toBeDefined();
  });
});
