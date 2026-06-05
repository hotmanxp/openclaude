import { describe, expect, test } from 'bun:test';
import { WorkerBadge } from './WorkerBadge.js';

describe('WorkerBadge (render smoke)', () => {
  test('exports a callable component', () => {
    expect(WorkerBadge).toBeDefined();
  });
});
