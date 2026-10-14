import {
  errorName,
  evaluateDecisionTier,
  withoutRationale,
} from './decision-live-apply.helpers.js';
import type { DecisionResult } from './decision.types.js';

describe('decision-live-apply helpers', () => {
  describe('evaluateDecisionTier', () => {
    it('evaluates the action with an empty context and returns tier and reasons', async () => {
      const evaluateAction = jest.fn().mockResolvedValue({
        tier: 'PROPOSE',
        reasons: ['tenant_override'],
        rule_id: 'rule-1',
        rule_version: 2,
      });

      await expect(
        evaluateDecisionTier({ evaluateAction }, 'decision.document_sort'),
      ).resolves.toEqual({ tier: 'PROPOSE', reasons: ['tenant_override'] });
      expect(evaluateAction).toHaveBeenCalledWith('decision.document_sort', {});
    });
  });

  describe('withoutRationale', () => {
    it('returns a copy without the rationale and leaves the input unchanged', () => {
      const suggestion: DecisionResult = {
        choice: 'Rechnung',
        raw_ref: 'raw-1',
        latency_ms: 3,
        provider: 'openrouter-jev',
        model: 'typesafe/jev-1.13',
        rationale: 'Quotes the excerpt.',
      };

      const copy = withoutRationale(suggestion);

      expect(copy).not.toHaveProperty('rationale');
      expect(copy).toEqual({ ...suggestion, rationale: undefined });
      expect(suggestion.rationale).toBe('Quotes the excerpt.');
    });
  });

  describe('errorName', () => {
    it('returns the name of an Error', () => {
      expect(errorName(new TypeError('boom'))).toBe('TypeError');
    });

    it('returns UnknownError for a value that is not an Error', () => {
      expect(errorName('boom')).toBe('UnknownError');
      expect(errorName(null)).toBe('UnknownError');
    });
  });
});
