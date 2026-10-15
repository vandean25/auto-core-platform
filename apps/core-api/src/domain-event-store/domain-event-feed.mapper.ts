import type { DomainEvent } from '@prisma/client';
import type { EstimateApprovalDecision } from '@prisma/client';
import { DOMAIN_EVENT_TYPES } from './domain-event.constants.js';

export type DomainEventEnvelopeDto = {
  event_id: string;
  event_type: string;
  schema_version: number;
  tenant_id: string;
  site_id: string;
  entity_id: string;
  occurred_at: string;
  trace_id: string;
  sequence: string;
  estimate_version_id?: string;
  decision?: EstimateApprovalDecision;
};

export function toDomainEventEnvelope(
  row: DomainEvent,
): DomainEventEnvelopeDto {
  const base: DomainEventEnvelopeDto = {
    event_id: row.id,
    event_type: row.event_type,
    schema_version: row.schema_version,
    tenant_id: row.tenant_id,
    site_id: row.site_id,
    entity_id: row.entity_id,
    occurred_at: row.occurred_at.toISOString(),
    trace_id: row.trace_id,
    sequence: row.sequence.toString(),
  };
  if (row.event_type === DOMAIN_EVENT_TYPES.workshopEstimateDecidedV1) {
    const payload = row.payload as {
      estimate_version_id?: string;
      decision?: EstimateApprovalDecision;
    } | null;
    if (payload?.estimate_version_id) {
      base.estimate_version_id = payload.estimate_version_id;
    }
    if (payload?.decision) {
      base.decision = payload.decision;
    }
  }
  return base;
}
