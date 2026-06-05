import { describe, expect, test } from 'bun:test';
import { HighlightedCodeFallback } from './Fallback.js';

describe('HighlightedCodeFallback (render smoke)', () => {
  test('exports a callable component', () => {
    expect(HighlightedCodeFallback).toBeDefined();
    expect(() => <HighlightedCodeFallback />).not.toThrow();
  });
});
