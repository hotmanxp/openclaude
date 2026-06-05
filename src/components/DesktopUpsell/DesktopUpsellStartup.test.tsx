import { describe, expect, test } from 'bun:test';
import { DesktopUpsellStartup } from './DesktopUpsellStartup.js';

describe('DesktopUpsellStartup (render smoke)', () => {
  test('exports a callable component', () => {
    expect(DesktopUpsellStartup).toBeDefined();
    expect(() => <DesktopUpsellStartup />).not.toThrow();
  });
});
