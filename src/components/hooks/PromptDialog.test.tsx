import { describe, expect, test } from 'bun:test';
import { PromptDialog } from './PromptDialog.js';

describe('PromptDialog (render smoke)', () => {
  test('exports a callable component', () => {
    expect(PromptDialog).toBeDefined();
    expect(() => <PromptDialog />).not.toThrow();
  });
});
