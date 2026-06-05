import { describe, expect, test } from 'bun:test';
import { UserToolCanceledMessage } from './UserToolCanceledMessage.js';

describe('UserToolCanceledMessage (render smoke)', () => {
  test('exports a callable component', () => {
    expect(UserToolCanceledMessage).toBeDefined();
    expect(() => <UserToolCanceledMessage />).not.toThrow();
  });
});
