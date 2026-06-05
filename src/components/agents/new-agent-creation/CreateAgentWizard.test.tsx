import { describe, expect, test } from 'bun:test';
import * as M from './CreateAgentWizard.js';

describe('CreateAgentWizard (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
