import { describe, expect, test } from 'bun:test';
import * as M from './SandboxPermissionRequest.js';

describe('SandboxPermissionRequest (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
