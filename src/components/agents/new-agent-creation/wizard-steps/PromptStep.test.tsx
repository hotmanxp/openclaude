import { describe, expect, test } from 'bun:test';
import { PromptStep } from './PromptStep.js';

describe('PromptStep (render smoke)', () => {
  test('exports a callable component', () => {
    expect(PromptStep).toBeDefined();
    expect(() => <PromptStep />).not.toThrow();
  });
});
