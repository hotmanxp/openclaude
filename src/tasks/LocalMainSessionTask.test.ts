import { describe, expect, test } from 'bun:test';
import * as M from './LocalMainSessionTask.js';

describe('LocalMainSessionTask (smoke)', () => {
  test('main export is callable and does not throw on weak input', () => {
    const fn = (M as any).default
      ?? Object.values(M).find((v: unknown) => typeof v === 'function');
    expect(fn).toBeDefined();
    expect(() => (fn as (...a: unknown[]) => unknown)(undefined)).not.toThrow();
  });
});
