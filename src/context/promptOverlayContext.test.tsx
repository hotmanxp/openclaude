import { describe, expect, test } from 'bun:test';
import { PromptOverlayProvider } from './promptOverlayContext.js';

describe('promptOverlayContext (render smoke)', () => {
  test('exports a callable component', () => {
    expect(PromptOverlayProvider).toBeDefined();
    expect(() => <PromptOverlayProvider>{null}</PromptOverlayProvider>).not.toThrow();
  });
});
