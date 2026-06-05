import { describe, expect, test } from 'bun:test';
import Link from './Link.js';

describe('Link (render smoke)', () => {
  test('exports a callable component', () => {
    expect(Link).toBeDefined();
    expect(() => <Link url="https://example.com">test</Link>).not.toThrow();
  });
});
