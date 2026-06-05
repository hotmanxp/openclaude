import { describe, expect, test } from 'bun:test';
import * as M from './WizardProvider.js';

describe('WizardProvider (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
