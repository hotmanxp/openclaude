import { describe, expect, test } from 'bun:test';
import { FpsMetricsProvider } from './fpsMetrics.js';

describe('fpsMetrics (render smoke)', () => {
  test('exports a callable component', () => {
    expect(FpsMetricsProvider).toBeDefined();
    expect(() => <FpsMetricsProvider getFpsMetrics={() => undefined}>{null}</FpsMetricsProvider>).not.toThrow();
  });
});
