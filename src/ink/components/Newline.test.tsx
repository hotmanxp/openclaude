import { describe, expect, test } from 'bun:test';
import Newline from './Newline.js';

describe('Newline (render smoke)', () => {
  test('exports a callable component', () => {
    expect(Newline).toBeDefined();
    expect(() => <Newline />).not.toThrow();
  });
});
