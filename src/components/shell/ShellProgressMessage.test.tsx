import { describe, expect, test } from 'bun:test';
import * as M from './ShellProgressMessage.js';

describe('ShellProgressMessage (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
