import { describe, expect, test } from 'bun:test';
import { FeedColumn } from './FeedColumn.js';

describe('FeedColumn (render smoke)', () => {
  test('exports a callable component', () => {
    expect(FeedColumn).toBeDefined();
    expect(() => <FeedColumn feeds={[]} maxWidth={40} />).not.toThrow();
  });
});
