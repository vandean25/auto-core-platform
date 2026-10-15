import { randomUUID } from 'node:crypto';
import type { EstimateApprovalDecision, Prisma } from '@prisma/client';
import {
  DOMAIN_EVENT_SCHEMA_VERSION,
  DOMAIN_EVENT_TYPES,
} from './domain-event.constants.js';

export type DomainEventTxClient = Prisma.TransactionClient;

export type AppendDomainEventInput = {
  tenantId: string;
  siteId: string;
  entityId: string;
  eventType: string;
  occurrenceKey: string;
  occurredAt: Date;
  traceId: string;
  payload?: Prisma.InputJsonObject;
};

export function buildDomainEventOccurrenceKey(
  eventType: string,
  occurrenceId: string,
): string {
  return `${eventType}:${occurrenceId}`;
}

export function buildDomainEventRow(
  input: AppendDomainEventInput,
): Prisma.DomainEventUncheckedCreateInput {
  return {
    id: randomUUID(),
    event_type: input.eventType,
    schema_version: DOMAIN_EVENT_SCHEMA_VERSION,
    tenant_id: input.tenantId,
    site_id: input.siteId,
    entity_id: input.entityId,
    occurred_at: input.occurredAt,
    trace_id: input.traceId,
    occurrence_key: input.occurrenceKey,
    payload: input.payload ?? undefined,
  };
}

export function buildWorkshopOrderScheduledPayload(): Prisma.InputJsonObject {
  return {};
}

export function buildWorkshopEstimateDecidedPayload(input: {
  estimateVersionId: string;
  decision: EstimateApprovalDecision;
}): Prisma.InputJsonObject {
  return {
    estimate_version_id: input.estimateVersionId,
    decision: input.decision,
  };
}

export function workshopOrderScheduledOccurrenceKey(orderId: string): string {
  return buildDomainEventOccurrenceKey(
    DOMAIN_EVENT_TYPES.workshopOrderScheduledV1,
    orderId,
  );
}

export function workshopEstimateDecidedOccurrenceKey(
  approvalId: string,
): string {
  return buildDomainEventOccurrenceKey(
    DOMAIN_EVENT_TYPES.workshopEstimateDecidedV1,
    approvalId,
  );
}
