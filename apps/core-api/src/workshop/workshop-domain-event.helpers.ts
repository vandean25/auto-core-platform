import type { EstimateApprovalDecision } from '@prisma/client';
import type {
  AppendedDomainEvent,
  DomainEventStoreService,
} from '../domain-event-store/domain-event-store.service.js';
import { DOMAIN_EVENT_TYPES } from '../domain-event-store/domain-event.constants.js';
import {
  buildWorkshopEstimateDecidedPayload,
  buildWorkshopOrderReadyPayload,
  buildWorkshopOrderScheduledPayload,
  type DomainEventTxClient,
  workshopEstimateDecidedOccurrenceKey,
  workshopOrderReadyOccurrenceKey,
  workshopOrderScheduledOccurrenceKey,
} from '../domain-event-store/domain-event.rows.js';

export async function appendWorkshopOrderScheduledDomainEvent(
  tx: DomainEventTxClient,
  store: DomainEventStoreService,
  input: {
    tenantId: string;
    siteId: string;
    orderId: string;
    occurredAt: Date;
    traceId: string;
  },
): Promise<void> {
  await store.appendInTx(tx, {
    tenantId: input.tenantId,
    siteId: input.siteId,
    entityId: input.orderId,
    eventType: DOMAIN_EVENT_TYPES.workshopOrderScheduledV1,
    occurrenceKey: workshopOrderScheduledOccurrenceKey(input.orderId),
    occurredAt: input.occurredAt,
    traceId: input.traceId,
    payload: buildWorkshopOrderScheduledPayload(),
  });
}

export async function appendWorkshopEstimateDecidedDomainEvent(
  tx: DomainEventTxClient,
  store: DomainEventStoreService,
  input: {
    tenantId: string;
    siteId: string;
    workshopOrderId: string;
    approvalId: string;
    versionId: string;
    decision: EstimateApprovalDecision;
    occurredAt: Date;
    traceId: string;
  },
): Promise<AppendedDomainEvent | null> {
  return store.appendInTx(tx, {
    tenantId: input.tenantId,
    siteId: input.siteId,
    entityId: input.workshopOrderId,
    eventType: DOMAIN_EVENT_TYPES.workshopEstimateDecidedV1,
    occurrenceKey: workshopEstimateDecidedOccurrenceKey(input.approvalId),
    occurredAt: input.occurredAt,
    traceId: input.traceId,
    payload: buildWorkshopEstimateDecidedPayload({
      estimateVersionId: input.versionId,
      decision: input.decision,
    }),
  });
}

export async function appendWorkshopOrderReadyDomainEvent(
  tx: DomainEventTxClient,
  store: DomainEventStoreService,
  input: {
    tenantId: string;
    siteId: string;
    workshopOrderId: string;
    occurrenceId: string;
    outboxId: string | null;
    resend: boolean;
    occurredAt: Date;
    traceId: string;
  },
): Promise<void> {
  await store.appendInTx(tx, {
    tenantId: input.tenantId,
    siteId: input.siteId,
    entityId: input.workshopOrderId,
    eventType: DOMAIN_EVENT_TYPES.workshopOrderReadyV1,
    occurrenceKey: workshopOrderReadyOccurrenceKey(input.occurrenceId),
    occurredAt: input.occurredAt,
    traceId: input.traceId,
    payload: buildWorkshopOrderReadyPayload({
      occurrenceId: input.occurrenceId,
      outboxId: input.outboxId,
      resend: input.resend,
    }),
  });
}
