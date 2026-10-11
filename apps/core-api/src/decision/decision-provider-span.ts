import { withSpan } from '../common/observability/trace.js';
import type { DecisionProvider } from './decision-provider.js';
import type { DecisionChoiceInput, DecisionResult } from './decision.types.js';

/**
 * One `agent.decision` span around a single provider call. Only the provider id, the use case and the
 * number of choices are recorded. The input, the choices and the suggestion never reach the span.
 */
export function traceDecisionProvider(
  provider: DecisionProvider,
  input: DecisionChoiceInput,
): Promise<DecisionResult | null> {
  return withSpan(
    'Agent decision',
    'agent.decision',
    {
      'agent.decision.provider': provider.providerId,
      'agent.decision.use_case': input.useCase,
      'agent.decision.choice_count': input.choices.length,
    },
    async (span) => {
      const suggestion = await provider.decide(input);
      span.setAttribute(
        'agent.decision.outcome',
        suggestion ? 'suggested' : 'none',
      );
      return suggestion;
    },
  );
}
