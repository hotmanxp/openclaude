import { describe, expect, test } from 'bun:test';
import { DiffDetailView } from './DiffDetailView.js';

describe('DiffDetailView (render smoke)', () => {
  test('exports a callable component', () => {
    expect(DiffDetailView).toBeDefined();
    expect(() => <DiffDetailView />).not.toThrow();
  });
});
