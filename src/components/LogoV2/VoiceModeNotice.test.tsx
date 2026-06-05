import { describe, expect, test } from 'bun:test';
import * as M from './VoiceModeNotice.js';

describe('VoiceModeNotice (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
