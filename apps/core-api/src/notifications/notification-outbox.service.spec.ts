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

describe('NotificationOutboxService.enqueueInternalManyInTx()', () => {
  const service = new NotificationOutboxService({} as never);
  const now = new Date('2026-10-12T08:00:00.000Z');
  const pushInput = (userId: string): EnqueueNotificationInput => ({
    tenantId: 'tenant-1',
    eventType: NotificationEventType.CUSTOMER_ESTIMATE_DECIDED,
    occurrenceId: 'event-1',
    channel: NotificationChannel.PUSH,
    recipientKind: NotificationRecipientKind.INTERNAL_TEAM,
    recipientKey: `user:${userId}`,
    recipientUserId: userId,
  });
  const makeManyTx = (createCount: number, existing: unknown[] = []) => ({
    notificationOutbox: {
      createMany: jest.fn().mockResolvedValue({ count: createCount }),
      findMany: jest.fn().mockResolvedValue(existing),
    },
  });

  it('writes nothing for no inputs', async () => {
    const tx = makeManyTx(0);
    await expect(service.enqueueInternalManyInTx(tx as never, [], now)).resolves.toEqual([]);
    expect(tx.notificationOutbox.createMany).not.toHaveBeenCalled();
  });

  it('inserts all rows in one statement and reports them as new', async () => {
    const tx = makeManyTx(2);

    const result = await service.enqueueInternalManyInTx(
      tx as never,
      [pushInput('u1'), pushInput('u2')],
      now,
    );

    expect(tx.notificationOutbox.createMany).toHaveBeenCalledTimes(1);
    const { data, skipDuplicates } = tx.notificationOutbox.createMany.mock.calls[0][0];
    expect(skipDuplicates).toBe(true);
    expect(data.map((row: { recipient_user_id: string }) => row.recipient_user_id)).toEqual(['u1', 'u2']);
    expect(result).toEqual(data.map((row: { id: string }) => ({ id: row.id, created: true })));
    expect(tx.notificationOutbox.findMany).not.toHaveBeenCalled();
  });

  it('reports a repeated key with the id of the existing row, as not new', async () => {
    const tx = makeManyTx(1, [{ id: 'old-row', idempotency_key: 'CUSTOMER_ESTIMATE_DECIDED:event-1:user:u1:PUSH' }]);
    tx.notificationOutbox.findMany.mockImplementation(async () => [
      { id: 'old-row', idempotency_key: 'CUSTOMER_ESTIMATE_DECIDED:event-1:user:u1:PUSH' },
      {
        id: tx.notificationOutbox.createMany.mock.calls[0][0].data[1].id,
        idempotency_key: 'CUSTOMER_ESTIMATE_DECIDED:event-1:user:u2:PUSH',
      },
    ]);

    const result = await service.enqueueInternalManyInTx(
      tx as never,
      [pushInput('u1'), pushInput('u2')],
      now,
    );

    expect(result[0]).toEqual({ id: 'old-row', created: false });
    expect(result[1].created).toBe(true);
    expect(tx.notificationOutbox.findMany).toHaveBeenCalledWith({
      where: {
        tenant_id: 'tenant-1',
        idempotency_key: {
          in: [
            'CUSTOMER_ESTIMATE_DECIDED:event-1:user:u1:PUSH',
            'CUSTOMER_ESTIMATE_DECIDED:event-1:user:u2:PUSH',
          ],
        },
      },
      select: { id: true, idempotency_key: true },
    });
  });

  it('refuses customer rows and rows of another tenant', async () => {
    const tx = makeManyTx(1);
    await expect(
      service.enqueueInternalManyInTx(
        tx as never,
        [{ ...pushInput('u1'), recipientKind: NotificationRecipientKind.CUSTOMER }],
        now,
      ),
    ).rejects.toThrow('internal rows of one tenant only');
    await expect(
      service.enqueueInternalManyInTx(
        tx as never,
        [pushInput('u1'), { ...pushInput('u2'), tenantId: 'tenant-2' }],
        now,
      ),
    ).rejects.toThrow('internal rows of one tenant only');
    expect(tx.notificationOutbox.createMany).not.toHaveBeenCalled();
  });
});
