import {
  NotificationChannel,
  NotificationEventType,
  NotificationMessageClass,
  NotificationOutboxStatus,
  NotificationRecipientKind,
} from '@prisma/client';
import {
  buildNotificationIdempotencyKey,
  buildNotificationOutboxRow,
  type EnqueueNotificationInput,
} from './notification-outbox.rows.js';

const NOW = new Date('2026-10-12T08:00:00.000Z');

const baseInput: EnqueueNotificationInput = {
  tenantId: 'tenant-1',
  eventType: NotificationEventType.WORKSHOP_TASK_WAITING_CUSTOMER,
  occurrenceId: 'labor-entry-1',
  channel: NotificationChannel.IN_APP,
  recipientKind: NotificationRecipientKind.INTERNAL_TEAM,
  recipientKey: 'advisors',
  workshopOrderId: 'order-1',
  sourceEntityType: 'WorkshopTask',
  sourceEntityId: 'task-1',
};

describe('notification outbox rows', () => {
  describe('buildNotificationIdempotencyKey()', () => {
    it('joins event, occurrence, recipient key and channel', () => {
      expect(buildNotificationIdempotencyKey(baseInput)).toBe(
        'WORKSHOP_TASK_WAITING_CUSTOMER:labor-entry-1:advisors:IN_APP',
      );
    });

    it('differs for each occurrence so a second pause of the same task is a new notice', () => {
      const second = buildNotificationIdempotencyKey({
        ...baseInput,
        occurrenceId: 'labor-entry-2',
      });
      expect(second).not.toBe(buildNotificationIdempotencyKey(baseInput));
    });

    it('differs per channel for the same occurrence and recipient', () => {
      const email = buildNotificationIdempotencyKey({
        ...baseInput,
        channel: NotificationChannel.EMAIL,
      });
      expect(email).not.toBe(buildNotificationIdempotencyKey(baseInput));
    });
  });

  describe('buildNotificationOutboxRow()', () => {
    it('stamps the tenant and writes a transactional, internal in-app row as accepted at write time', () => {
      const row = buildNotificationOutboxRow(baseInput, NOW);

      expect(row).toMatchObject({
        tenant_id: 'tenant-1',
        event_type: NotificationEventType.WORKSHOP_TASK_WAITING_CUSTOMER,
        channel: NotificationChannel.IN_APP,
        recipient_kind: NotificationRecipientKind.INTERNAL_TEAM,
        recipient_email: null,
        message_class: NotificationMessageClass.TRANSACTIONAL,
        workshop_order_id: 'order-1',
        source_entity_type: 'WorkshopTask',
        source_entity_id: 'task-1',
        status: NotificationOutboxStatus.ACCEPTED,
        attempts: 0,
        accepted_at: NOW,
        provider: 'in-app',
      });
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('writes an email row as pending and due now, with no provider yet', () => {
      const row = buildNotificationOutboxRow(
        {
          ...baseInput,
          channel: NotificationChannel.EMAIL,
          recipientKind: NotificationRecipientKind.CUSTOMER,
          recipientKey: 'customer:customer-1',
          recipientEmail: 'kunde@example.at',
        },
        NOW,
      );

      expect(row).toMatchObject({
        status: NotificationOutboxStatus.PENDING,
        next_attempt_at: NOW,
        accepted_at: null,
        provider: null,
        recipient_email: 'kunde@example.at',
      });
    });

    it('omits payload when none is given and keeps it when given', () => {
      expect(buildNotificationOutboxRow(baseInput, NOW)).not.toHaveProperty(
        'payload',
      );
      const withPayload = buildNotificationOutboxRow(
        { ...baseInput, payload: { taskId: 'task-1' } },
        NOW,
      );
      expect(withPayload.payload).toEqual({ taskId: 'task-1' });
    });

    it('generates a fresh id for every write', () => {
      expect(buildNotificationOutboxRow(baseInput, NOW).id).not.toBe(
        buildNotificationOutboxRow(baseInput, NOW).id,
      );
    });
  });
});
