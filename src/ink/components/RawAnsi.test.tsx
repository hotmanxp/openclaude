import { describe, expect, test } from 'bun:test';
import { RawAnsi } from './RawAnsi.js';

describe('RawAnsi (render smoke)', () => {
  test('exports a callable component', () => {
    expect(RawAnsi).toBeDefined();
    expect(() => <RawAnsi lines={[]} width={80} />).not.toThrow();
  });
});
