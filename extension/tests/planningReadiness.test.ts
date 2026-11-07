import { describe, expect, it } from 'vitest';
import { comparisonCriterionWasRedacted } from '../lib/agent/planningReadiness';

describe('privacy-preserving task readiness', () => {
  it('stops when privacy filtering obscures the decision criterion', () => {
    expect(comparisonCriterionWasRedacted('Choose the lowest price.', 'Choose the LOCAL_SURNAME_1 price.')).toBe(true);
  });
  it('allows private task values to stay hidden when the criterion is retained', () => {
    expect(comparisonCriterionWasRedacted('Find the cheapest ticket for Mira Sen.', 'Find the cheapest ticket for LOCAL_PERSON_NAME_1.')).toBe(false);
  });
  it('does not require comparison words in ordinary control tasks', () => {
    expect(comparisonCriterionWasRedacted('Fill email a@example.invalid', 'Fill email LOCAL_EMAIL_1')).toBe(false);
  });
});
