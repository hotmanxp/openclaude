import { describe, expect, test } from 'bun:test';
import { BackgroundTaskStatus } from './BackgroundTaskStatus.js';

describe('BackgroundTaskStatus (render smoke)', () => {
  test('exports a callable component', () => {
    expect(BackgroundTaskStatus).toBeDefined();
    expect(() => <BackgroundTaskStatus />).not.toThrow();
  });
});
