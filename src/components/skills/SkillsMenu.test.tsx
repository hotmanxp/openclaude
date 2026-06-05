import { describe, expect, test } from 'bun:test';
import * as M from './SkillsMenu.js';

describe('SkillsMenu (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
