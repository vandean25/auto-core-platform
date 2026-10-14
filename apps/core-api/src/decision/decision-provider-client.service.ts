import { Inject, Injectable, Logger } from '@nestjs/common';
import { DECISION_PROVIDER_TOKEN } from './decision.constants.js';
import { readDecisionHttpTimeoutMs } from './decision-env.js';
import { DECISION_LIVE_LOG_CONTEXT } from './decision-live-apply.constants.js';
import { errorName } from './decision-live-apply.helpers.js';
import type { ProviderCall } from './decision-live-apply.types.js';
import type { DecisionProvider } from './decision-provider.js';
import { traceDecisionProvider } from './decision-provider-span.js';
import type { DecisionChoiceInput, DecisionResult } from './decision.types.js';

class DecisionLiveTimeoutError extends Error {}

/**
 * Bounded calls to the decision provider for live apply. The race enforces the
 * timeout even when a provider ignores its own. Provider error text is never
 * returned, only a reason code.
 */
@Injectable()
export class DecisionProviderClient {
  private readonly logger = new Logger(DECISION_LIVE_LOG_CONTEXT);

  constructor(
    @Inject(DECISION_PROVIDER_TOKEN)
    private readonly decisionProvider: DecisionProvider,
  ) {}

  get providerId(): string {
    return this.decisionProvider.providerId;
  }

  async ask(
    input: DecisionChoiceInput,
    deadlineAt: number,
  ): Promise<ProviderCall> {
    const remainingMs = deadlineAt - Date.now();
    if (remainingMs <= 0) {
      return { ok: false, reason: 'budget_exceeded', suggestion: null };
    }
    const timeoutMs = Math.min(readDecisionHttpTimeoutMs(), remainingMs);
    let timer: ReturnType<typeof setTimeout> | undefined;
    const timeout = new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new DecisionLiveTimeoutError()),
        timeoutMs,
      );
    });
    try {
      const suggestion = await Promise.race([
        traceDecisionProvider(this.decisionProvider, input),
        timeout,
      ]);
      return judgeSuggestion(input.choices, suggestion);
    } catch (error) {
      return this.failedCall(error);
    } finally {
      clearTimeout(timer);
    }
  }

  private failedCall(error: unknown): ProviderCall {
    if (error instanceof DecisionLiveTimeoutError) {
      return { ok: false, reason: 'timeout', suggestion: null };
    }
    this.logger.debug(
      `Decision live provider call failed: ${errorName(error)}`,
    );
    return { ok: false, reason: 'provider_error', suggestion: null };
  }
}

/** A missing suggestion, or one whose choice is outside `choices`, is not usable. */
export function judgeSuggestion(
  choices: string[],
  suggestion: DecisionResult | null,
): ProviderCall {
  if (!suggestion) {
    return { ok: false, reason: 'no_suggestion', suggestion: null };
  }
  if (!choices.includes(suggestion.choice)) {
    return { ok: false, reason: 'invalid_choice', suggestion: null };
  }
  return { ok: true, suggestion };
}
