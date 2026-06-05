// @ts-nocheck
import { describe, expect, test } from 'bun:test';
import * as M from './CapabilitiesSection.js';

describe('CapabilitiesSection (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
