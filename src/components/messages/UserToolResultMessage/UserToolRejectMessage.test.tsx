import { describe, expect, test } from 'bun:test';
import { UserToolRejectMessage } from './UserToolRejectMessage.js';

describe('UserToolRejectMessage (render smoke)', () => {
  test('exports a callable component', () => {
    expect(UserToolRejectMessage).toBeDefined();
    expect(() => <UserToolRejectMessage input={{}} progressMessagesForMessage={[]} tools={[]} lookups={{ toolUseByToolUseID: new Map() }} verbose={false} />).not.toThrow();
  });
});
