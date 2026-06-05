import { describe, expect, test } from 'bun:test';
import { SandboxDoctorSection } from './SandboxDoctorSection.js';

describe('SandboxDoctorSection (render smoke)', () => {
  test('exports a callable component', () => {
    expect(SandboxDoctorSection).toBeDefined();
  });
});
