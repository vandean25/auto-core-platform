import {
  EstimateApprovalDecision,
  NotificationChannel,
  NotificationEventType,
  NotificationRecipientKind,
  WorkshopEstimateStatus,
  type Prisma,
} from '@prisma/client';
import { DOMAIN_EVENT_TYPES } from '../domain-event-store/domain-event.constants.js';
import type { EnqueueNotificationInput } from '../notifications/notification-outbox.rows.js';
import { ESTIMATE_DECISION_RECIPIENT_KEY } from './workshop-estimate-decision.helpers.js';

export type EstimateDecidedEventPayload = {
  estimate_version_id: string;
  decision: EstimateApprovalDecision;
};

export type EstimateDecidedDomainContext = {
  eventId: string;
  tenantId: string;
  eventType: string;
  payload: Prisma.JsonValue | null;
  version: {
    id: string;
    status: WorkshopEstimateStatus;
    estimate: {
      workshop_order_id: string;
      workshop_order: { site_id: string | null };
    };
  } | null;
  waitingCustomerTaskCount: number;
  /** The order's mechanic and the mechanics of its tasks (employee ids). */
  mechanicEmployeeIds: string[];
};

/** What the PUSH rows of a decision need (ADR-0033 §3): advisors of the site, and on approval the mechanics. */
export type EstimateDecidedPush = {
  workshopOrderId: string;
  siteId: string;
  decision: EstimateApprovalDecision;
  extraEmployeeIds: string[];
};

export type EstimateDecidedConsumerOutcome =
  | { kind: 'skip'; reason: string }
  | {
      kind: 'notify';
      input: EnqueueNotificationInput;
      push: EstimateDecidedPush;
      reason: string;
    };

export function parseEstimateDecidedPayload(
  payload: Prisma.JsonValue | null,
): EstimateDecidedEventPayload | null {
  if (!payload || typeof payload !== 'object' || Array.isArray(payload)) {
    return null;
  }
  const record = payload as Record<string, unknown>;
  const versionId = record.estimate_version_id;
  const decision = record.decision;
  if (typeof versionId !== 'string' || versionId.length === 0) {
    return null;
  }
  if (
    decision !== EstimateApprovalDecision.APPROVED &&
    decision !== EstimateApprovalDecision.DECLINED
  ) {
    return null;
  }
  return {
    estimate_version_id: versionId,
    decision,
  };
}

export function decideEstimateDecidedConsumerOutcome(
  context: EstimateDecidedDomainContext,
): EstimateDecidedConsumerOutcome {
  if (context.eventType !== DOMAIN_EVENT_TYPES.workshopEstimateDecidedV1) {
    return { kind: 'skip', reason: 'UNSUPPORTED_EVENT_TYPE' };
  }
  const parsed = parseEstimateDecidedPayload(context.payload);
  if (!parsed) {
    return { kind: 'skip', reason: 'INVALID_EVENT_PAYLOAD' };
  }
  const version = context.version;
  if (!version || version.id !== parsed.estimate_version_id) {
    return { kind: 'skip', reason: 'VERSION_NOT_FOUND' };
  }
  const siteId = version.estimate.workshop_order.site_id;
  if (!siteId) {
    return { kind: 'skip', reason: 'ORDER_SITE_MISSING' };
  }
  const expectedStatus =
    parsed.decision === EstimateApprovalDecision.APPROVED
      ? WorkshopEstimateStatus.APPROVED
      : WorkshopEstimateStatus.DECLINED;
  if (
    version.status === WorkshopEstimateStatus.SUPERSEDED ||
    version.status === WorkshopEstimateStatus.SENT ||
    version.status === WorkshopEstimateStatus.DRAFT ||
    version.status === WorkshopEstimateStatus.EXPIRED
  ) {
    return { kind: 'skip', reason: 'VERSION_NOT_ACTIONABLE' };
  }
  if (version.status !== expectedStatus) {
    return { kind: 'skip', reason: 'VERSION_DECISION_MISMATCH' };
  }

  const needsHumanReview = context.waitingCustomerTaskCount > 0;
  const reason =
    parsed.decision === EstimateApprovalDecision.APPROVED
      ? needsHumanReview
        ? 'CUSTOMER_ESTIMATE_APPROVED_REVIEW_WAITING_TASKS'
        : 'CUSTOMER_ESTIMATE_APPROVED'
      : needsHumanReview
        ? 'CUSTOMER_ESTIMATE_DECLINED_REVIEW_WAITING_TASKS'
        : 'CUSTOMER_ESTIMATE_DECLINED';

  const workshopOrderId = version.estimate.workshop_order_id;
  return {
    kind: 'notify',
    reason,
    push: {
      workshopOrderId,
      siteId,
      decision: parsed.decision,
      extraEmployeeIds:
        parsed.decision === EstimateApprovalDecision.APPROVED
          ? context.mechanicEmployeeIds
          : [],
    },
    input: {
      tenantId: context.tenantId,
      eventType: NotificationEventType.CUSTOMER_ESTIMATE_DECIDED,
      occurrenceId: context.eventId,
      channel: NotificationChannel.IN_APP,
      recipientKind: NotificationRecipientKind.INTERNAL_TEAM,
      recipientKey: ESTIMATE_DECISION_RECIPIENT_KEY,
      workshopOrderId,
      sourceEntityType: 'WorkshopEstimateVersion',
      sourceEntityId: version.id,
      payload: {
        decision: parsed.decision,
        estimate_version_id: version.id,
        workshop_order_id: workshopOrderId,
        needs_human_review: needsHumanReview,
      },
    },
  };
}
