import { describe, expect, test } from 'bun:test';
import Spacer from './Spacer.js';

describe('Spacer (render smoke)', () => {
  test('exports a callable component', () => {
    expect(Spacer).toBeDefined();
    expect(() => <Spacer />).not.toThrow();
  });
});
