import { describe, expect, test } from 'bun:test';
import { TranscriptSharePrompt } from './TranscriptSharePrompt.js';

describe('TranscriptSharePrompt (render smoke)', () => {
  test('exports a callable component', () => {
    expect(TranscriptSharePrompt).toBeDefined();
    expect(() => <TranscriptSharePrompt />).not.toThrow();
  });
});
