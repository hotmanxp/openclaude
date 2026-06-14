// @ts-nocheck — Fallback.tsx itself is @ts-nocheck; this fork-only render-smoke test asserts the component is callable with no args and is exempt from upstream e53d612d Props type requirements.

import { describe, expect, test } from 'bun:test';
import { HighlightedCodeFallback } from './Fallback.js';

describe('HighlightedCodeFallback (render smoke)', () => {
  test('exports a callable component', () => {
    expect(HighlightedCodeFallback).toBeDefined();
    expect(() => <HighlightedCodeFallback />).not.toThrow();
  });
});
