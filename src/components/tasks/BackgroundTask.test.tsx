import { describe, expect, test } from 'bun:test';
import { BackgroundTask } from './BackgroundTask.js';

describe('BackgroundTask (render smoke)', () => {
  test('exports a callable component', () => {
    expect(BackgroundTask).toBeDefined();
    expect(() => <BackgroundTask />).not.toThrow();
  });
});
