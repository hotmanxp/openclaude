import { describe, expect, test } from 'bun:test';
import { UserToolResultMessage } from './UserToolResultMessage.js';

describe('UserToolResultMessage (render smoke)', () => {
  test('exports a callable component', () => {
    expect(UserToolResultMessage).toBeDefined();
    expect(() => <UserToolResultMessage param={{ type: 'input', id: '', content: '' }} message={{ role: 'user', id: '' }} lookups={{ toolUseByToolUseID: new Map() }} progressMessagesForMessage={[]} tools={[]} verbose={false} width={80} />).not.toThrow();
  });
});
