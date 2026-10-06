import { DECISION_PROVIDER_TOKEN } from './decision.constants.js';
import type { DecisionProvider } from './decision-provider.js';
import {
  readDecisionHttpTimeoutMs,
  readDecisionProviderId,
  readOpenRouterJevModelId,
} from './decision-env.js';
import { NoopDecisionProvider } from './noop-decision.provider.js';
import { OpenRouterJevClient } from './openrouter-jev.client.js';
import { OpenRouterJevDecisionProvider } from './openrouter-jev-decision.provider.js';

export function createDecisionProvider(
  env: NodeJS.ProcessEnv = process.env,
): DecisionProvider {
  const providerId = readDecisionProviderId(env);
  if (providerId === 'openrouter-jev') {
    const client = new OpenRouterJevClient({
      apiKey: env.OPENROUTER_API_KEY,
      modelId: readOpenRouterJevModelId(env),
      timeoutMs: readDecisionHttpTimeoutMs(env),
    });
    return new OpenRouterJevDecisionProvider(client);
  }
  return new NoopDecisionProvider();
}

export const decisionProviderFactory = {
  provide: DECISION_PROVIDER_TOKEN,
  useFactory: () => createDecisionProvider(),
};
