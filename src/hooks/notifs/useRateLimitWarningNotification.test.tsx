import { describe, expect, test } from 'bun:test';
import * as M from './useRateLimitWarningNotification.js';

describe('useRateLimitWarningNotification (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
