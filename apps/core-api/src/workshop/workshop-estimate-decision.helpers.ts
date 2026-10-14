import {
  ConflictException,
  UnprocessableEntityException,
} from '@nestjs/common';
import {
  EstimateApprovalChannel,
  EstimateApprovalDecision,
  type EstimateCustomerReaction,
  NotificationChannel,
  NotificationEventType,
  NotificationRecipientKind,
  Prisma,
  WorkshopEstimateStatus,
} from '@prisma/client';
import type {
  NotificationOutboxService,
  NotificationOutboxTxClient,
} from '../notifications/notification-outbox.service.js';

/** Channels an advisor may record. LINK is the customer's own link, and ADVISOR_RECORDED is legacy. */
export const ADVISOR_DECISION_CHANNELS = [
  EstimateApprovalChannel.PHONE,
  EstimateApprovalChannel.IN_PERSON,
  EstimateApprovalChannel.EMAIL,
] as const;
export type AdvisorDecisionChannel = (typeof ADVISOR_DECISION_CHANNELS)[number];

/** Recipient key of the internal in-app event (no personal data in the unique key, ADR-0025 §6). */
export const ESTIMATE_DECISION_RECIPIENT_KEY = 'advisors';

type DecisionConflict = { code: string; message: string };

const EXPIRED_CONFLICT: DecisionConflict = {
  code: 'ESTIMATE_VERSION_EXPIRED',
  message: 'The validity of this estimate version has passed.',
};

const DECISION_CONFLICTS: Partial<
  Record<WorkshopEstimateStatus, DecisionConflict>
> = {
  DRAFT: {
    code: 'ESTIMATE_VERSION_NOT_SENT',
    message: 'Only a sent estimate version can be decided.',
  },
  SUPERSEDED: {
    code: 'ESTIMATE_VERSION_SUPERSEDED',
    message:
      'A newer version of this estimate was sent. The decision belongs to the current version.',
  },
  EXPIRED: EXPIRED_CONFLICT,
  APPROVED: {
    code: 'ESTIMATE_VERSION_ALREADY_DECIDED',
    message: 'This estimate version already has a decision.',
  },
  DECLINED: {
    code: 'ESTIMATE_VERSION_ALREADY_DECIDED',
    message: 'This estimate version already has a decision.',
  },
};

function isPastValidity(
  version: { valid_until: Date | null },
  now: Date,
): boolean {
  return (
    version.valid_until !== null &&
    version.valid_until.getTime() <= now.getTime()
  );
}

function decisionConflict(
  version: { status: WorkshopEstimateStatus; valid_until: Date | null },
  now: Date,
): DecisionConflict | null {
  if (version.status !== WorkshopEstimateStatus.SENT) {
    return DECISION_CONFLICTS[version.status] ?? null;
  }
  return isPastValidity(version, now) ? EXPIRED_CONFLICT : null;
}

/** 409 for a version that cannot take a decision (ADR-0025 §4). Outdated and superseded versions are refused. */
export function assertVersionDecidable(
  version: { status: WorkshopEstimateStatus; valid_until: Date | null },
  now: Date,
): void {
  const conflict = decisionConflict(version, now);
  if (conflict) {
    throw new ConflictException({
      code: conflict.code,
      message: conflict.message,
    });
  }
}

/** The advisor must confirm the amount the customer was quoted: it has to equal the sent gross total. */
export function assertAmountQuoted(
  quoted: string,
  total: Prisma.Decimal | null,
): void {
  if (total === null) {
    throw new ConflictException({
      code: 'ESTIMATE_VERSION_NOT_DECIDABLE',
      message: 'The estimate version has no total to confirm the amount with.',
    });
  }
  if (!new Prisma.Decimal(quoted).equals(total)) {
    throw new UnprocessableEntityException({
      code: 'ESTIMATE_AMOUNT_MISMATCH',
      message: `The amount quoted (${quoted}) does not match the estimate total (${total.toFixed(2)}).`,
      expected_amount_gross: total.toFixed(2),
    });
  }
}

/** The customer's decision time: now by default, or a time from the call, between sending and now. */
export function resolveAdvisorDecidedAt(
  value: string | null | undefined,
  sentAt: Date | null,
  now: Date,
): Date {
  if (value === undefined || value === null) {
    return now;
  }
  const decidedAt = new Date(value);
  const invalid =
    Number.isNaN(decidedAt.getTime()) ||
    decidedAt.getTime() > now.getTime() ||
    (sentAt !== null && decidedAt.getTime() < sentAt.getTime());
  if (invalid) {
    throw new UnprocessableEntityException({
      code: 'ESTIMATE_DECISION_TIME_INVALID',
      message:
        'The decision time must be after the estimate was sent and must not lie in the future.',
    });
  }
  return decidedAt;
}

/**
 * The customer reaction recorded with a decision must fit it (AUT-355). An approval never comes with a refusal, and a
 * refusal never comes with an agreement. No reaction is always allowed.
 */
const REACTIONS_FOR_DECISION: Record<
  EstimateApprovalDecision,
  readonly EstimateCustomerReaction[]
> = {
  [EstimateApprovalDecision.APPROVED]: ['AGREED', 'QUESTIONED'],
  [EstimateApprovalDecision.DECLINED]: [
    'DECLINED',
    'QUESTIONED',
    'CALLBACK_REQUESTED',
  ],
};

/**
 * The reaction is optional. One that is given has to fit the decision, so a record never says "refused" and "agreed"
 * at once. A null from a client counts as no reaction, the same as an absent one.
 */
export function assertReactionFits(
  decision: EstimateApprovalDecision,
  reaction: EstimateCustomerReaction | null | undefined,
): void {
  if (
    reaction === undefined ||
    reaction === null ||
    REACTIONS_FOR_DECISION[decision].includes(reaction)
  ) {
    return;
  }
  throw new UnprocessableEntityException({
    code: 'ESTIMATE_REACTION_MISMATCH',
    message:
      'The customer reaction does not fit the decision that was recorded.',
  });
}

/** Version status a decision moves to. Only SENT versions are moved, and only by a guarded update. */
export function decisionToVersionStatus(
  decision: EstimateApprovalDecision,
): WorkshopEstimateStatus {
  return decision === EstimateApprovalDecision.APPROVED
    ? WorkshopEstimateStatus.APPROVED
    : WorkshopEstimateStatus.DECLINED;
}

export type AdvisorDecisionEvidenceInput = {
  tenantId: string;
  versionId: string;
  version: {
    snapshot_sha256: string | null;
    pdf_sha256: string | null;
    legal_text_version: string | null;
    legal_text_sha256: string | null;
  };
  decision: EstimateApprovalDecision;
  channel: AdvisorDecisionChannel;
  decidedAt: Date;
  amountGross: string;
  reaction: EstimateCustomerReaction | undefined;
  note: string;
  recordedByUserId: string;
};

/**
 * Evidence row for an advisor-recorded decision. The hashes and the legal text come from the sent version, so the
 * row refers to exactly what the customer was shown. No IP address, user agent or typed name is stored for an
 * advisor-recorded decision (AUT-355).
 */
export function buildAdvisorApprovalData(
  input: AdvisorDecisionEvidenceInput,
): Prisma.WorkshopEstimateApprovalUncheckedCreateInput {
  const { version } = input;
  if (
    !version.snapshot_sha256 ||
    !version.legal_text_version ||
    !version.legal_text_sha256
  ) {
    throw new ConflictException({
      code: 'ESTIMATE_VERSION_NOT_DECIDABLE',
      message:
        'The estimate version has no sent snapshot to record a decision against.',
    });
  }
  return {
    tenant_id: input.tenantId,
    workshop_estimate_version_id: input.versionId,
    channel: input.channel,
    decision: input.decision,
    decided_at: input.decidedAt,
    content_sha256: version.snapshot_sha256,
    pdf_sha256: version.pdf_sha256,
    legal_text_version: version.legal_text_version,
    legal_text_sha256: version.legal_text_sha256,
    legal_blocks_accepted: false,
    b2c_declaration_accepted: false,
    amount_quoted_gross: new Prisma.Decimal(input.amountGross),
    customer_reaction: input.reaction ?? null,
    note: input.note,
    recorded_by_user_id: input.recordedByUserId,
  };
}

/**
 * Domain event for a decision, written in the caller's transaction. It is an internal in-app row, accepted at
 * write time, so nothing is sent to the customer and no request handler calls a provider (ADR-0025 §6).
 */
export async function enqueueEstimateDecisionEvent(
  tx: NotificationOutboxTxClient,
  outbox: NotificationOutboxService,
  input: {
    tenantId: string;
    approvalId: string;
    versionId: string;
    workshopOrderId: string;
    decision: EstimateApprovalDecision;
    channel: EstimateApprovalChannel;
  },
): Promise<void> {
  await outbox.enqueueInTx(tx, {
    tenantId: input.tenantId,
    eventType: NotificationEventType.CUSTOMER_ESTIMATE_DECIDED,
    occurrenceId: input.approvalId,
    channel: NotificationChannel.IN_APP,
    recipientKind: NotificationRecipientKind.INTERNAL_TEAM,
    recipientKey: ESTIMATE_DECISION_RECIPIENT_KEY,
    workshopOrderId: input.workshopOrderId,
    sourceEntityType: 'WorkshopEstimateVersion',
    sourceEntityId: input.versionId,
    payload: { decision: input.decision, channel: input.channel },
  });
}
