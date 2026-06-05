import { describe, expect, test } from 'bun:test';
import { RemoteSessionProgress } from './RemoteSessionProgress.js';

describe('RemoteSessionProgress (render smoke)', () => {
  test('exports a callable component', () => {
    expect(RemoteSessionProgress).toBeDefined();
    expect(() => <RemoteSessionProgress />).not.toThrow();
  });
});
