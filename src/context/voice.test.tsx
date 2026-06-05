import { describe, expect, test } from 'bun:test';
import { VoiceProvider } from './voice.js';

describe('voice (render smoke)', () => {
  test('exports a callable component', () => {
    expect(VoiceProvider).toBeDefined();
    expect(() => <VoiceProvider>{null}</VoiceProvider>).not.toThrow();
  });
});
