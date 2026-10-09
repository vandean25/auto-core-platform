import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { DECISION_PROVIDER_TOKEN } from './decision.constants.js';
import { readDecisionShadowEnabled } from './decision-env.js';
import type { DecisionProvider } from './decision-provider.js';
import { hashDecisionInput } from './decision-input-hash.js';
import type {
  DecisionResult,
  DecisionShadowRecordParams,
} from './decision.types.js';

const MAX_CONCURRENT_SHADOWS = 4;
const MAX_QUEUED_SHADOWS = 100;

@Injectable()
export class DecisionShadowService {
  private readonly logger = new Logger(DecisionShadowService.name);
  private readonly shadowQueue: DecisionShadowRecordParams[] = [];
  private activeShadowCount = 0;

  constructor(
    private readonly prisma: PrismaService,
    private readonly requestContext: RequestContextService,
    @Inject(DECISION_PROVIDER_TOKEN)
    private readonly decisionProvider: DecisionProvider,
  ) {}

  isShadowEnabled(): boolean {
    return readDecisionShadowEnabled();
  }

  /**
   * Fire-and-forget shadow logging. Errors are swallowed and never affect callers.
   */
  scheduleShadow(params: DecisionShadowRecordParams): void {
    if (
      !this.isShadowEnabled() ||
      this.shadowQueue.length >= MAX_QUEUED_SHADOWS
    ) {
      return;
    }
    this.shadowQueue.push(redactShadowParams(params));
    this.drainShadowQueue();
  }

  private drainShadowQueue(): void {
    while (
      this.activeShadowCount < MAX_CONCURRENT_SHADOWS &&
      this.shadowQueue.length > 0
    ) {
      const params = this.shadowQueue.shift();
      if (!params) return;
      this.activeShadowCount += 1;
      void this.runShadow(params)
        .catch((error) => {
          this.logger.debug(
            `Decision shadow logging failed for ${params.useCase}: ${String(error)}`,
          );
        })
        .finally(() => {
          this.activeShadowCount -= 1;
          this.drainShadowQueue();
        });
    }
  }

  resolveTraceId(explicit?: string): string {
    return explicit ?? this.requestContext.getTraceId() ?? randomUUID();
  }

  private async runShadow(params: DecisionShadowRecordParams): Promise<void> {
    let suggestion: DecisionResult | null = null;
    let error: string | null = null;

    try {
      suggestion = await this.decisionProvider.decide({
        useCase: params.useCase,
        input: params.input,
        choices: params.choices,
      });
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    await this.writeShadowRecord(params, {
      suggestion,
      error,
      providerId: this.decisionProvider.providerId,
    });
  }

  /**
   * Persists one `decision_shadow_logs` row. `params` must already be redacted
   * with `redactShadowParams`. AUT-413 live mode reuses this with the suggestion
   * it already fetched, so Jev is never called twice for one decision.
   */
  async writeShadowRecord(
    params: DecisionShadowRecordParams,
    outcome: {
      suggestion: DecisionResult | null;
      error: string | null;
      providerId: string;
    },
  ): Promise<void> {
    const { suggestion } = outcome;
    await this.prisma.decisionShadowLog.create({
      data: {
        tenant_id: params.tenantId,
        trace_id: params.traceId,
        use_case: params.useCase,
        input_hash: hashDecisionInput({
          useCase: params.useCase,
          input: params.input,
          choices: params.choices,
        }),
        input_redacted_json: toInputJson(params.input),
        suggestion_json: suggestion ?? Prisma.JsonNull,
        actual_outcome_json: toInputJson(params.actualOutcome),
        match: suggestion
          ? suggestion.choice === params.actualOutcome.choice
          : null,
        provider: suggestion?.provider ?? outcome.providerId,
        model: suggestion?.model ?? null,
        latency_ms: suggestion?.latency_ms ?? null,
        error: outcome.error,
      },
    });
  }
}

export function redactShadowParams(
  params: DecisionShadowRecordParams,
): DecisionShadowRecordParams {
  const choiceAliases =
    params.useCase === 'import_row_matching'
      ? new Map(
          params.choices.map((choice, index) => [
            choice,
            `choice_${index + 1}`,
          ]),
        )
      : new Map<string, string>();
  const choices =
    params.useCase === 'import_row_matching'
      ? params.choices.map(
          (choice, index) => choiceAliases.get(choice) ?? `choice_${index + 1}`,
        )
      : params.choices;
  const actualChoice =
    choiceAliases.get(params.actualOutcome.choice) ??
    params.actualOutcome.choice;
  return {
    ...params,
    input: redactValue(params.input, '', choiceAliases),
    choices,
    actualOutcome: {
      ...params.actualOutcome,
      choice: actualChoice,
    },
  };
}

function redactValue(
  value: unknown,
  key: string,
  choiceAliases: Map<string, string>,
): unknown {
  if (typeof value === 'string') {
    return (
      choiceAliases.get(value) ?? (isSensitiveKey(key) ? '[REDACTED]' : value)
    );
  }
  if (Array.isArray(value)) {
    return value.map((item) => redactValue(item, key, choiceAliases));
  }
  if (value && typeof value === 'object') {
    return Object.fromEntries(
      Object.entries(value).map(([childKey, childValue]) => [
        childKey,
        redactValue(childValue, childKey, choiceAliases),
      ]),
    );
  }
  return value;
}

function isSensitiveKey(key: string): boolean {
  const normalizedKey = key
    .replace(/[A-Z]/g, (letter) => `_${letter.toLowerCase()}`)
    .toLowerCase();
  return /(?:^|_)(?:name|email|phone|vat|address|street|zip|city|external_id|id|label|text|content|vin|plate|rationale|birth_date|iban|account|tax_id|registration_number|contact)(?:_|$)/.test(
    normalizedKey,
  );
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
