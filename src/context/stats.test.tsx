import { describe, expect, test } from 'bun:test';
import { StatsProvider } from './stats.js';

describe('stats (render smoke)', () => {
  test('exports a callable component', () => {
    expect(StatsProvider).toBeDefined();
    expect(() => <StatsProvider>{null}</StatsProvider>).not.toThrow();
  });
});
