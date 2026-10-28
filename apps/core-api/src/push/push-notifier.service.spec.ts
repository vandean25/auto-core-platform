import { NotificationEventType } from '@prisma/client';
import { PushNotifierService } from './push-notifier.service.js';

const event = {
  tenantId: 'tenant-1',
  siteId: 'site-1',
  workshopOrderId: 'order-1',
  eventType: NotificationEventType.CUSTOMER_ESTIMATE_DECIDED,
  occurrenceId: 'event-1',
  payload: { decision: 'APPROVED' } as const,
};

/** A transaction in which the given users opted in, are advisors and members of the site. */
function txWithRecipients(userIds: string[]) {
  const users = userIds.map((user_id) => ({ user_id }));
  return {
    pushPreference: { findMany: jest.fn().mockResolvedValue(users) },
    employee: { findMany: jest.fn().mockResolvedValue(users) },
    siteMembership: { findMany: jest.fn().mockResolvedValue(users) },
  } as never;
}

function setup(rows: Array<{ id: string; created: boolean }>) {
  const outbox = { enqueueInternalManyInTx: jest.fn().mockResolvedValue(rows) };
  const wakeUps = { enqueueWakeUp: jest.fn().mockResolvedValue(undefined) };
  const service = new PushNotifierService(outbox as never, wakeUps as never);
  return { service, outbox, wakeUps };
}

describe('PushNotifierService', () => {
  it('writes one PUSH row per recipient with a stable key, in the caller transaction, and returns the new ones', async () => {
    const { service, outbox } = setup([
      { id: 'r1', created: true },
      { id: 'r2', created: false },
    ]);
    const tx = txWithRecipients(['u1', 'u2']);
    const now = new Date('2026-10-28T12:00:00Z');

    await expect(service.enqueueInTx(tx, event, now)).resolves.toEqual(['r1']);

    expect(outbox.enqueueInternalManyInTx).toHaveBeenCalledWith(
      tx,
      [
        expect.objectContaining({
          tenantId: 'tenant-1',
          eventType: 'CUSTOMER_ESTIMATE_DECIDED',
          occurrenceId: 'event-1',
          channel: 'PUSH',
          recipientKind: 'INTERNAL_TEAM',
          recipientKey: 'user:u1',
          recipientUserId: 'u1',
          workshopOrderId: 'order-1',
          payload: { decision: 'APPROVED' },
        }),
        expect.objectContaining({
          recipientKey: 'user:u2',
          recipientUserId: 'u2',
        }),
      ],
      now,
    );
  });

  it('writes nothing when no one is a recipient', async () => {
    const { service, outbox } = setup([]);

    await expect(
      service.enqueueInTx(txWithRecipients([]), event),
    ).resolves.toEqual([]);
    expect(outbox.enqueueInternalManyInTx).toHaveBeenCalledWith(
      expect.anything(),
      [],
      expect.any(Date),
    );
  });

  it('wakes the worker once per new row, and a failed wake-up never throws', async () => {
    const { service, wakeUps } = setup([]);
    wakeUps.enqueueWakeUp.mockRejectedValueOnce(new Error('queue down'));

    await expect(
      service.wakeUp('tenant-1', ['r1', 'r2']),
    ).resolves.toBeUndefined();

    expect(wakeUps.enqueueWakeUp).toHaveBeenCalledWith({
      outboxId: 'r1',
      tenantId: 'tenant-1',
    });
    expect(wakeUps.enqueueWakeUp).toHaveBeenCalledWith({
      outboxId: 'r2',
      tenantId: 'tenant-1',
    });
  });
});
