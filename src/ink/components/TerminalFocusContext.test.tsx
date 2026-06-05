import { describe, expect, test } from 'bun:test';
import * as M from './TerminalFocusContext.js';

describe('TerminalFocusContext (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
