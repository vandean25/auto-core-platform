import {
  NotificationChannel,
  NotificationEventType,
  NotificationRecipientKind,
} from '@prisma/client';
import type { EnqueueNotificationInput } from '../notifications/notification-outbox.rows.js';

/**
 * Advisor notification for a task that enters WAITING_CUSTOMER (ADR-0014 §4.3, superseded for
 * customer contact by ADR-0025 §6). It is internal only: no customer email or SMS is sent. The
 * outbox row is written in the same transaction as the task transition, so it is durable.
 *
 * `laborEntryId` is the labor entry the pause or switch closed. Each pause closes exactly one entry,
 * so it identifies this occurrence and a repeated write for the same pause is a no-op.
 */
export function buildWaitingCustomerNotification(params: {
  tenantId: string;
  taskId: string;
  workshopOrderId: string;
  mechanicEmployeeId: string;
  laborEntryId: string;
}): EnqueueNotificationInput {
  return {
    tenantId: params.tenantId,
    eventType: NotificationEventType.WORKSHOP_TASK_WAITING_CUSTOMER,
    occurrenceId: params.laborEntryId,
    channel: NotificationChannel.IN_APP,
    recipientKind: NotificationRecipientKind.INTERNAL_TEAM,
    recipientKey: 'advisors',
    workshopOrderId: params.workshopOrderId,
    sourceEntityType: 'WorkshopTask',
    sourceEntityId: params.taskId,
    payload: {
      taskId: params.taskId,
      workshopOrderId: params.workshopOrderId,
      mechanicEmployeeId: params.mechanicEmployeeId,
      laborEntryId: params.laborEntryId,
    },
  };
}
