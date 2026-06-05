import { describe, expect, test } from 'bun:test';
import { ClaudeInChromeMenu } from './chrome.js';

describe('chrome (render smoke)', () => {
  test('exports a callable component', () => {
    expect(ClaudeInChromeMenu).toBeDefined();
    expect(() => ClaudeInChromeMenu({})).not.toThrow();
  });
});
