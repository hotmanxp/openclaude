import { describe, expect, test } from 'bun:test';
import { ManagedSettingsSecurityDialog } from './ManagedSettingsSecurityDialog.js';

describe('ManagedSettingsSecurityDialog (render smoke)', () => {
  test('exports a callable component', () => {
    expect(ManagedSettingsSecurityDialog).toBeDefined();
    expect(() => <ManagedSettingsSecurityDialog />).not.toThrow();
  });
});
