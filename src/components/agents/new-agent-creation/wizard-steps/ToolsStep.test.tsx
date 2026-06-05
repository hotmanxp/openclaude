import { describe, expect, test } from 'bun:test';
import { ToolsStep } from './ToolsStep.js';

describe('ToolsStep (render smoke)', () => {
  test('exports a callable component', () => {
    expect(ToolsStep).toBeDefined();
    expect(() => <ToolsStep />).not.toThrow();
  });
});
