import { describe, expect, test } from 'bun:test';
import * as M from './PowerShellPermissionRequest.js';

describe('PowerShellPermissionRequest (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
