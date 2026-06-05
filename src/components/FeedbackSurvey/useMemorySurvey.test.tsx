import { describe, expect, test } from 'bun:test';
import * as M from './useMemorySurvey.js';

describe('useMemorySurvey (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
