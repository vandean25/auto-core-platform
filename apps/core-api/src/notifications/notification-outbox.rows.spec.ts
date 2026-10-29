import { createHash } from 'node:crypto';
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

const emailInput: EnqueueNotificationInput = {
  tenantId: 'tenant-1',
  eventType: NotificationEventType.WORKSHOP_TASK_WAITING_CUSTOMER,
  occurrenceId: 'estimate-version-1',
  channel: NotificationChannel.EMAIL,
  recipientKind: NotificationRecipientKind.CUSTOMER,
  recipientKey: 'customer:customer-1',
  email: {
    recipientEmail: 'kunde@example.at',
    subject: 'Auftrag Nr. 2026-0042',
    text: 'Guten Tag,\n',
    senderName: 'Werkstatt Beispiel GmbH',
    replyToEmail: 'werkstatt@example.at',
  },
};

const pushInput: EnqueueNotificationInput = {
  tenantId: 'tenant-1',
  eventType: NotificationEventType.CUSTOMER_ESTIMATE_DECIDED,
  occurrenceId: 'version-1',
  channel: NotificationChannel.PUSH,
  recipientKind: NotificationRecipientKind.INTERNAL_TEAM,
  recipientKey: 'user:user-1',
  recipientUserId: 'user-1',
  workshopOrderId: 'order-1',
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
    it('stamps the tenant and writes an internal in-app row as accepted at write time', () => {
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
        body: null,
        body_sha256: null,
      });
      expect(row.id).toMatch(/^[0-9a-f-]{36}$/);
    });

    it('writes an email row as pending and due now, with the rendered message and its hash', () => {
      const row = buildNotificationOutboxRow(emailInput, NOW);

      expect(row).toMatchObject({
        status: NotificationOutboxStatus.PENDING,
        next_attempt_at: NOW,
        accepted_at: null,
        provider: null,
        recipient_email: 'kunde@example.at',
        subject: 'Auftrag Nr. 2026-0042',
        body: 'Guten Tag,\n',
        body_sha256: createHash('sha256')
          .update('Guten Tag,\n', 'utf8')
          .digest('hex'),
        sender_name: 'Werkstatt Beispiel GmbH',
        reply_to_email: 'werkstatt@example.at',
        attempts: 0,
      });
    });

    it('refuses an email row without a rendered message', () => {
      expect(() =>
        buildNotificationOutboxRow({ ...emailInput, email: undefined }, NOW),
      ).toThrow('EMAIL outbox rows need a rendered message');
    });

    it('refuses a draft that names more than one recipient or breaks a header', () => {
      expect(() =>
        buildNotificationOutboxRow(
          {
            ...emailInput,
            email: {
              ...emailInput.email!,
              recipientEmail: 'kunde@example.at, victim@evil.example',
            },
          },
          NOW,
        ),
      ).toThrow('EMAIL recipient must be one plain address');
      expect(() =>
        buildNotificationOutboxRow(
          {
            ...emailInput,
            email: {
              ...emailInput.email!,
              subject: 'Auftrag\r\nBcc: victim@evil.example',
            },
          },
          NOW,
        ),
      ).toThrow('EMAIL subject and sender name must be single-line');
    });

    it('writes a push row as pending and due now, for one user, without any rendered text', () => {
      const row = buildNotificationOutboxRow(pushInput, NOW);

      expect(row).toMatchObject({
        channel: NotificationChannel.PUSH,
        status: NotificationOutboxStatus.PENDING,
        next_attempt_at: NOW,
        accepted_at: null,
        provider: null,
        recipient_user_id: 'user-1',
        recipient_email: null,
        subject: null,
        body: null,
        idempotency_key:
          'CUSTOMER_ESTIMATE_DECIDED:version-1:user:user-1:PUSH',
        attempts: 0,
      });
    });

    it('refuses a push row without a recipient user, and a rendered message on a push row', () => {
      expect(() =>
        buildNotificationOutboxRow({ ...pushInput, recipientUserId: null }, NOW),
      ).toThrow('PUSH outbox rows need the recipient user');
      expect(() =>
        buildNotificationOutboxRow(
          { ...pushInput, email: emailInput.email },
          NOW,
        ),
      ).toThrow('Only EMAIL outbox rows carry a rendered message');
    });

    it('refuses a rendered message on an in-app row', () => {
      expect(() =>
        buildNotificationOutboxRow(
          { ...baseInput, email: emailInput.email },
          NOW,
        ),
      ).toThrow('Only EMAIL outbox rows carry a rendered message');
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
