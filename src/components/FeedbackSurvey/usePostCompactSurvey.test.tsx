import { describe, expect, test } from 'bun:test';
import * as M from './usePostCompactSurvey.js';

describe('usePostCompactSurvey (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
