import { Injectable } from '@nestjs/common';
import type { Request } from 'express';
import { AgentActionLogService } from '../../agent-action-log/agent-action-log.service.js';
import type { PublicApiScope } from '../public-api-scopes.js';
import type { ApiKeyPrincipal } from './api-key-principal.js';

export type ApiKeyRequestOutcome = 'EXECUTED' | 'REFUSED' | 'FAILED';

export type ApiKeyRequestAuditInput = {
  principal: ApiKeyPrincipal;
  method: string;
  /** Route template, for example `/api/public/v1/customers/:id`. Never the raw URL or query string. */
  route: string;
  scope: PublicApiScope | null;
  httpStatus: number;
  outcome: ApiKeyRequestOutcome;
  reason?: string;
};

/**
 * Writes one agent-action-log row per request made with a verified tenant API key (ADR-0026).
 * Rows carry the key id and the route. They never carry the token or the secret.
 */
@Injectable()
export class ApiKeyRequestAuditService {
  constructor(private readonly agentActionLog: AgentActionLogService) {}

  async record(input: ApiKeyRequestAuditInput): Promise<void> {
    await this.agentActionLog.record({
      actorType: 'API_KEY',
      apiKeyId: input.principal.apiKeyId,
      actionType: input.scope
        ? `public_api.${input.scope}`
        : 'public_api.unmapped',
      tier: 'AUTO',
      status: input.outcome,
      inputSummary: {
        method: input.method,
        route: input.route,
        scope: input.scope,
        keyPrefix: input.principal.keyPrefix,
      },
      resultSummary: {
        httpStatus: input.httpStatus,
        reason: input.reason ?? null,
      },
    });
  }
}

export function describeApiKeyRoute(
  request: Pick<Request, 'path'> & { route?: { path?: unknown } },
): string {
  const template = request.route?.path;
  return typeof template === 'string' ? template : request.path;
}

export function outcomeForHttpStatus(httpStatus: number): ApiKeyRequestOutcome {
  if (httpStatus < 400) {
    return 'EXECUTED';
  }
  if (httpStatus === 401 || httpStatus === 403 || httpStatus === 429) {
    return 'REFUSED';
  }
  return 'FAILED';
}
