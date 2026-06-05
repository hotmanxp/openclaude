import { describe, expect, test } from 'bun:test';
import { MemoryStep } from './MemoryStep.js';

describe('MemoryStep (render smoke)', () => {
  test('exports a callable component', () => {
    expect(MemoryStep).toBeDefined();
    expect(() => <MemoryStep />).not.toThrow();
  });
});
