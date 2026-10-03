import { Inject, Injectable, Logger } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { RequestContextService } from '../common/services/request-context.service.js';
import { DECISION_PROVIDER_TOKEN } from './decision.constants.js';
import { readDecisionShadowEnabled } from './decision-env.js';
import type { DecisionProvider } from './decision-provider.js';
import { hashDecisionInput } from './decision-input-hash.js';
import type { DecisionShadowRecordParams } from './decision.types.js';

@Injectable()
export class DecisionShadowService {
  private readonly logger = new Logger(DecisionShadowService.name);

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
    if (!this.isShadowEnabled()) {
      return;
    }
    void this.runShadow(params).catch((error) => {
      this.logger.debug(
        `Decision shadow logging failed for ${params.useCase}: ${String(error)}`,
      );
    });
  }

  resolveTraceId(explicit?: string): string {
    return explicit ?? this.requestContext.getTraceId() ?? randomUUID();
  }

  private async runShadow(params: DecisionShadowRecordParams): Promise<void> {
    const inputHash = hashDecisionInput({
      useCase: params.useCase,
      input: params.input,
      choices: params.choices,
    });
    const redactedInput = params.input;

    let suggestionJson: Prisma.InputJsonValue | typeof Prisma.JsonNull =
      Prisma.JsonNull;
    let provider = this.decisionProvider.providerId;
    let model: string | null = null;
    let latencyMs: number | null = null;
    let error: string | null = null;
    let match: boolean | null = null;

    try {
      const suggestion = await this.decisionProvider.decide({
        useCase: params.useCase,
        input: params.input,
        choices: params.choices,
      });
      if (suggestion) {
        suggestionJson = suggestion as Prisma.InputJsonValue;
        provider = suggestion.provider;
        model = suggestion.model;
        latencyMs = suggestion.latency_ms;
        match = suggestion.choice === params.actualOutcome.choice;
      }
    } catch (caught) {
      error = caught instanceof Error ? caught.message : String(caught);
    }

    await this.prisma.decisionShadowLog.create({
      data: {
        tenant_id: params.tenantId,
        trace_id: params.traceId,
        use_case: params.useCase,
        input_hash: inputHash,
        input_redacted_json: toInputJson(redactedInput),
        suggestion_json: suggestionJson,
        actual_outcome_json: toInputJson(params.actualOutcome),
        match,
        provider,
        model,
        latency_ms: latencyMs,
        error,
      },
    });
  }
}

function toInputJson(value: unknown): Prisma.InputJsonValue {
  return JSON.parse(JSON.stringify(value)) as Prisma.InputJsonValue;
}
