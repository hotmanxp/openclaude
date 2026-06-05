import { describe, expect, test } from 'bun:test';
import { MailboxProvider } from './mailbox.js';

describe('mailbox (render smoke)', () => {
  test('exports a callable component', () => {
    expect(MailboxProvider).toBeDefined();
    expect(() => <MailboxProvider>{null}</MailboxProvider>).not.toThrow();
  });
});
