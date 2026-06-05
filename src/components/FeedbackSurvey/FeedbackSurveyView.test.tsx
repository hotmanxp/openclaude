import { describe, expect, test } from 'bun:test';
import { FeedbackSurveyView } from './FeedbackSurveyView.js';

describe('FeedbackSurveyView (render smoke)', () => {
  test('exports a callable component', () => {
    expect(FeedbackSurveyView).toBeDefined();
    expect(() => <FeedbackSurveyView />).not.toThrow();
  });
});
