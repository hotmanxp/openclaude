import { describe, expect, test } from 'bun:test';
import * as M from './GlimmerMessage.js';

describe('GlimmerMessage (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
