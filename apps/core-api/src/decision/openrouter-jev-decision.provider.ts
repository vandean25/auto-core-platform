import type { DecisionProvider } from './decision-provider.js';
import type { DecisionChoiceInput, DecisionResult } from './decision.types.js';
import { OpenRouterJevClient } from './openrouter-jev.client.js';

export class OpenRouterJevDecisionProvider implements DecisionProvider {
  readonly providerId = 'openrouter-jev';

  constructor(private readonly client: OpenRouterJevClient) {}

  async decide(input: DecisionChoiceInput): Promise<DecisionResult | null> {
    if (!this.client.isConfigured()) {
      return null;
    }
    return this.client.decide(input);
  }
}
