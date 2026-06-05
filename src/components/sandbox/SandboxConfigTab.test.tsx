import { describe, expect, test } from 'bun:test';
import { SandboxConfigTab } from './SandboxConfigTab.js';

describe('SandboxConfigTab (render smoke)', () => {
  test('exports a callable component', () => {
    expect(SandboxConfigTab).toBeDefined();
  });
});
