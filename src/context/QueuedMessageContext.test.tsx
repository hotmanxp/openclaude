import { describe, expect, test } from 'bun:test';
import { QueuedMessageProvider } from './QueuedMessageContext.js';

describe('QueuedMessageContext (render smoke)', () => {
  test('exports a callable component', () => {
    expect(QueuedMessageProvider).toBeDefined();
    expect(() => <QueuedMessageProvider isFirst={false}>{null}</QueuedMessageProvider>).not.toThrow();
  });
});
