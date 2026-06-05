import { describe, expect, test } from 'bun:test';
import { FeedbackSurvey } from './FeedbackSurvey.js';

describe('FeedbackSurvey (render smoke)', () => {
  test('exports a callable component', () => {
    expect(FeedbackSurvey).toBeDefined();
    expect(() => <FeedbackSurvey />).not.toThrow();
  });
});
