import type { DecisionChoiceInput, DecisionResult } from './decision.types.js';

export interface DecisionProvider {
  readonly providerId: string;
  decide(input: DecisionChoiceInput): Promise<DecisionResult | null>;
}
