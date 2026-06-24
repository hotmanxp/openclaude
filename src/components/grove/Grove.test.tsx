import { describe, expect, test } from 'bun:test';
import { GroveDialog } from './Grove.js';

describe('Grove (render smoke)', () => {
  test('exports a callable component', () => {
    expect(GroveDialog).toBeDefined();
    expect(() => (
      <GroveDialog
        showIfAlreadyViewed={false}
        location="settings"
        onDone={() => {}}
      />
    )).not.toThrow();
  });
});
