import { describe, expect, test } from 'bun:test';
import * as M from './SandboxDependenciesTab.js';

describe('SandboxDependenciesTab (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
