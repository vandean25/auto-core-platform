import type { DecisionProvider } from './decision-provider.js';
import type { DecisionResult } from './decision.types.js';

export class NoopDecisionProvider implements DecisionProvider {
  readonly providerId = 'noop';

  decide(): Promise<DecisionResult | null> {
    return Promise.resolve(null);
  }
}
