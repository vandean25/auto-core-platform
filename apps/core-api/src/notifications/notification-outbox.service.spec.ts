import {
  NotificationChannel,
  NotificationEventType,
  NotificationRecipientKind,
} from '@prisma/client';
import { NotificationOutboxService } from './notification-outbox.service.js';
import {
  buildNotificationIdempotencyKey,
  type EnqueueNotificationInput,
} from './notification-outbox.rows.js';

const input: EnqueueNotificationInput = {
  tenantId: 'tenant-1',
  eventType: NotificationEventType.WORKSHOP_TASK_WAITING_CUSTOMER,
  occurrenceId: 'labor-entry-1',
  channel: NotificationChannel.IN_APP,
  recipientKind: NotificationRecipientKind.INTERNAL_TEAM,
  recipientKey: 'advisors',
};

function makeTx(overrides: {
  createCount?: number;
  existing?: { id: string } | null;
}) {
  return {
    notificationOutbox: {
      createMany: jest.fn().mockResolvedValue({
        count: overrides.createCount ?? 1,
      }),
      findFirst: jest.fn().mockResolvedValue(overrides.existing ?? null),
    },
  };
}

describe('NotificationOutboxService.enqueueInTx()', () => {
  const marketingUnsubscribe = {
    mintTokenForMarketingMessage: jest.fn(),
    buildUnsubscribePostUrl: jest.fn(),
  };
  const service = new NotificationOutboxService(
    marketingUnsubscribe as never,
  );

  it('writes one row through the caller transaction with skipDuplicates', async () => {
    const tx = makeTx({ createCount: 1 });

    const result = await service.enqueueInTx(
      tx as never,
      input,
      new Date('2026-10-12T08:00:00.000Z'),
    );

    expect(tx.notificationOutbox.createMany).toHaveBeenCalledTimes(1);
    const args = tx.notificationOutbox.createMany.mock.calls[0][0] as {
      data: Array<Record<string, unknown>>;
      skipDuplicates: boolean;
    };
    expect(args.skipDuplicates).toBe(true);
    expect(args.data).toHaveLength(1);
    expect(args.data[0]).toMatchObject({
      tenant_id: 'tenant-1',
      idempotency_key:
        'WORKSHOP_TASK_WAITING_CUSTOMER:labor-entry-1:advisors:IN_APP',
    });
    expect(result).toEqual({
      blocked: false,
      id: args.data[0].id,
      created: true,
    });
    expect(tx.notificationOutbox.findFirst).not.toHaveBeenCalled();
  });

  it('returns the existing row and created=false when the key was already written', async () => {
    const tx = makeTx({ createCount: 0, existing: { id: 'existing-row' } });

    const result = await service.enqueueInTx(tx as never, input);

    expect(result).toEqual({
      blocked: false,
      id: 'existing-row',
      created: false,
    });
    expect(tx.notificationOutbox.findFirst).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        idempotency_key:
          'WORKSHOP_TASK_WAITING_CUSTOMER:labor-entry-1:advisors:IN_APP',
      },
      select: { id: true },
    });
  });

  it('keys estimate-decided notices by domain event id for consumer idempotency', () => {
    const key = buildNotificationIdempotencyKey({
      eventType: NotificationEventType.CUSTOMER_ESTIMATE_DECIDED,
      occurrenceId: 'domain-event-1',
      recipientKey: 'advisors',
      channel: NotificationChannel.IN_APP,
    });
    expect(key).toBe(
      'CUSTOMER_ESTIMATE_DECIDED:domain-event-1:advisors:IN_APP',
    );
  });

  it('fails loudly if a skipped write cannot be found afterwards', async () => {
    const tx = makeTx({ createCount: 0, existing: null });

    await expect(service.enqueueInTx(tx as never, input)).rejects.toThrow(
      /neither created nor found/,
    );
  });
});
