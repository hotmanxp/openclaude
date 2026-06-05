import { describe, expect, test } from 'bun:test';
import Text from './Text.js';

describe('Text (render smoke)', () => {
  test('exports a callable component', () => {
    expect(Text).toBeDefined();
    expect(() => <Text>hello</Text>).not.toThrow();
  });
});
