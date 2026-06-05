import { describe, expect, test } from 'bun:test';
import * as M from './SandboxSettings.js';

describe('SandboxSettings (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
