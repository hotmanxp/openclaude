import { describe, expect, test } from 'bun:test';
import { UserToolErrorMessage } from './UserToolErrorMessage.js';

describe('UserToolErrorMessage (render smoke)', () => {
  test('exports a callable component', () => {
    expect(UserToolErrorMessage).toBeDefined();
    expect(() => <UserToolErrorMessage progressMessagesForMessage={[]} tools={[]} param={{ type: 'input', id: '', content: '' }} verbose={false} />).not.toThrow();
  });
});
