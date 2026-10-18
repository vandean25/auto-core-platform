import { Logger } from '@nestjs/common';
import {
  NotificationChannel,
  NotificationEventType,
  NotificationRecipientKind,
  WorkshopEstimateStatus,
  type Customer,
  type Prisma,
} from '@prisma/client';
import type { NotificationCloudTasksService } from '../notifications/notification-cloud-tasks.service.js';
import type { NotificationOutboxService } from '../notifications/notification-outbox.service.js';
import { mintApprovalToken } from './workshop-estimate-approval-token.helpers.js';
import { buildCustomerEstimateEmail } from './workshop-estimate-customer-email.js';

const logger = new Logger('WorkshopEstimateEmailQueue');

/** What the send transaction knows about the version and its customer. */
export interface EstimateEmailInput {
  tenantId: string;
  versionId: string;
  workshopOrderId: string;
  controllerLegalEntityId: string;
  vehicle: { make: string; model: string };
  customer: Customer;
  sellerName: string;
  estimateNumber: string;
  approvalBaseUrl: string;
  validUntil: Date;
  issuedAt: Date;
}

/**
 * Mints the approval token and queues the estimate email inside the send transaction, so the row exists only if the
 * version was sent (ADR-0025 §6 and §7). The database keeps the token's hash. The raw token appears only in the link in
 * the outbox body, which the worker redacts once the row is terminal. Returns the outbox row id.
 */
export async function queueEstimateEmailInTx(
  tx: Prisma.TransactionClient,
  outbox: NotificationOutboxService,
  input: EstimateEmailInput,
): Promise<string | null> {
  const tenant = await tx.tenant.findFirst({
    where: { id: input.tenantId },
    select: { default_locale: true },
  });
  const token = mintApprovalToken();
  const email = buildCustomerEstimateEmail({
    customer: input.customer,
    tenantDefaultLocale: tenant?.default_locale ?? 'de',
    vehicle: input.vehicle,
    sellerName: input.sellerName,
    estimateNumber: input.estimateNumber,
    approvalBaseUrl: input.approvalBaseUrl,
    approvalToken: token.raw,
    validUntil: input.validUntil,
  });

  await tx.workshopEstimateApprovalToken.create({
    data: {
      tenant_id: input.tenantId,
      workshop_estimate_version_id: input.versionId,
      token_sha256: token.sha256,
      expires_at: input.validUntil,
    },
  });
  const enqueued = await outbox.enqueueInTx(
    tx,
    {
      tenantId: input.tenantId,
      eventType: NotificationEventType.CUSTOMER_ESTIMATE_SENT,
      occurrenceId: input.versionId,
      channel: NotificationChannel.EMAIL,
      recipientKind: NotificationRecipientKind.CUSTOMER,
      recipientKey: `customer:${input.customer.id}`,
      workshopOrderId: input.workshopOrderId,
      sourceEntityType: 'WorkshopEstimateVersion',
      sourceEntityId: input.versionId,
      consentPurpose: 'ORDER_COMMUNICATION',
      controllerLegalEntityId: input.controllerLegalEntityId,
      email: email.draft,
      // The customer the message is for, so a refusal of the address can clear that customer's confirmation.
      payload: { customer_id: input.customer.id },
    },
    input.issuedAt,
  );
  if (enqueued.blocked) {
    return null;
  }
  return enqueued.id;
}

/**
 * A send that supersedes an earlier version makes that version's approval links stop working (ADR-0025 §7), whatever
 * their expiry.
 */
export async function invalidateSupersededApprovalTokens(
  tx: Prisma.TransactionClient,
  tenantId: string,
  estimateId: string,
  issuedAt: Date,
): Promise<void> {
  await tx.workshopEstimateApprovalToken.updateMany({
    where: {
      tenant_id: tenantId,
      invalidated_at: null,
      consumed_at: null,
      version: {
        estimate_id: estimateId,
        status: WorkshopEstimateStatus.SUPERSEDED,
      },
    },
    data: { invalidated_at: issuedAt },
  });
}

/**
 * The row is committed, so a wake-up now delivers it without waiting for the recovery sweep (ADR-0025 §6). A failed
 * wake-up is logged and never thrown: the sweep wakes the row once its grace has passed.
 */
export async function wakeUpAfterCommit(
  wakeUps: NotificationCloudTasksService,
  outboxId: string,
  tenantId: string,
): Promise<void> {
  await wakeUps
    .enqueueWakeUp({ outboxId, tenantId })
    .catch((cause: unknown) =>
      logger.warn(
        `Could not schedule the first send of notification ${outboxId}: ${cause instanceof Error ? cause.name : 'unknown error'}`,
      ),
    );
}
