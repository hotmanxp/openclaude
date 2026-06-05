import { describe, expect, test } from 'bun:test';
import * as M from './WelcomeV2.js';

describe('WelcomeV2 (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
