import { describe, expect, test } from 'bun:test';
import * as M from './WizardDialogLayout.js';

describe('WizardDialogLayout (import smoke)', () => {
  test('module loads without error', () => {
    expect(M).toBeDefined();
  });
});
