import { describe, expect, test } from 'bun:test';
import Button from './Button.js';

describe('Button (render smoke)', () => {
  test('exports a callable component', () => {
    expect(Button).toBeDefined();
    expect(() => <Button onAction={() => {}}>test</Button>).not.toThrow();
  });
});
