import { describe, expect, test } from 'bun:test';
import { Feed } from './Feed.js';

describe('Feed (render smoke)', () => {
  test('exports a callable component', () => {
    expect(Feed).toBeDefined();
    expect(() => <Feed config={{ title: 'test', lines: [] }} actualWidth={40} />).not.toThrow();
  });
});
