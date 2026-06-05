import { describe, expect, test } from 'bun:test';
import { MobileQRCode } from './mobile.js';

describe('mobile (render smoke)', () => {
  test('exports a callable component', () => {
    expect(MobileQRCode).toBeDefined();
    expect(() => MobileQRCode({})).not.toThrow();
  });
});
