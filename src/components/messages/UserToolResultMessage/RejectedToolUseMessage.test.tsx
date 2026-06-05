import { describe, expect, test } from 'bun:test';
import { RejectedToolUseMessage } from './RejectedToolUseMessage.js';

describe('RejectedToolUseMessage (render smoke)', () => {
  test('exports a callable component', () => {
    expect(RejectedToolUseMessage).toBeDefined();
    expect(() => <RejectedToolUseMessage />).not.toThrow();
  });
});
