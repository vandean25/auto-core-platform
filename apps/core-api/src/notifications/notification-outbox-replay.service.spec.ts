import { ForbiddenException, Logger } from '@nestjs/common';
import { REDACTED_APPROVAL_LINK } from './notification-body-redaction.js';
import { NotificationOutboxReplayService } from './notification-outbox-replay.service.js';
import { NOTIFICATION_UNSENT_WINDOW_MS } from './notification-retry.policy.js';

describe('NotificationOutboxReplayService', () => {
  const ROW_ID = '5d0c1a1e-3b7e-4f8a-9c2d-1e2f3a4b5c6d';
  const OTHER_ID = '9a1b2c3d-4e5f-4a6b-8c7d-0e1f2a3b4c5d';
  const NOW = new Date('2026-10-14T09:00:00.000Z');

  let prisma: {
    notificationOutbox: { findFirst: jest.Mock; updateMany: jest.Mock };
  };
  let tenantContext: { getAuthenticatedUser: jest.Mock };
  let wakeUps: { enqueueWakeUp: jest.Mock };
  let service: NotificationOutboxReplayService;

  /** A FAILED email row whose body is still stored: the replayable case. */
  const failedEmailRow = (
    overrides: Record<string, unknown> = {},
  ): Record<string, unknown> => ({
    id: ROW_ID,
    tenant_id: 'tenant-1',
    status: 'FAILED',
    channel: 'EMAIL',
    body: 'Guten Tag, anbei Ihr Kostenvoranschlag.',
    body_sha256: 'a'.repeat(64),
    body_purged_at: null,
    createdAt: new Date(NOW.getTime() - 60 * 60 * 1000),
    ...overrides,
  });

  const signedInAs = (role: string | undefined) =>
    tenantContext.getAuthenticatedUser.mockReturnValue(
      role === undefined
        ? undefined
        : { userId: 'user-1', email: '', tenantId: 'tenant-1', role },
    );

  beforeEach(() => {
    prisma = {
      notificationOutbox: {
        findFirst: jest.fn().mockResolvedValue(failedEmailRow()),
        updateMany: jest.fn().mockResolvedValue({ count: 1 }),
      },
    };
    tenantContext = { getAuthenticatedUser: jest.fn() };
    signedInAs('OWNER');
    wakeUps = { enqueueWakeUp: jest.fn().mockResolvedValue(undefined) };
    service = new NotificationOutboxReplayService(
      prisma as never,
      tenantContext as never,
      wakeUps as never,
    );
  });

  afterEach(() => {
    jest.restoreAllMocks();
  });

  describe('role', () => {
    it.each(['OWNER', 'ADMIN'])('lets %s replay', async (role) => {
      signedInAs(role);

      await expect(service.replay([ROW_ID], NOW)).resolves.toEqual({
        replayed: [ROW_ID],
        refused: [],
      });
    });

    it.each(['ADVISOR', 'SALES', 'MECHANIC', 'API_KEY', 'worker', undefined])(
      'refuses %s before it reads any row',
      async (role) => {
        signedInAs(role);

        await expect(service.replay([ROW_ID], NOW)).rejects.toBeInstanceOf(
          ForbiddenException,
        );
        expect(prisma.notificationOutbox.findFirst).not.toHaveBeenCalled();
        expect(prisma.notificationOutbox.updateMany).not.toHaveBeenCalled();
        expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
      },
    );
  });

  describe('a replayable row', () => {
    it('goes back to PENDING with a fresh attempt budget, and is woken only after that write', async () => {
      await service.replay([ROW_ID], NOW);

      expect(prisma.notificationOutbox.updateMany).toHaveBeenCalledWith({
        where: {
          id: ROW_ID,
          tenant_id: 'tenant-1',
          status: 'FAILED',
          body_purged_at: null,
        },
        data: {
          status: 'PENDING',
          attempts: 0,
          next_attempt_at: NOW,
          failed_at: null,
          lease_token: null,
          lease_expires_at: null,
        },
      });
      expect(wakeUps.enqueueWakeUp).toHaveBeenCalledWith({
        outboxId: ROW_ID,
        tenantId: 'tenant-1',
      });
      expect(
        prisma.notificationOutbox.updateMany.mock.invocationCallOrder[0],
      ).toBeLessThan(wakeUps.enqueueWakeUp.mock.invocationCallOrder[0]);
    });

    it('replays an in-app row, which has no body hash to check', async () => {
      prisma.notificationOutbox.findFirst.mockResolvedValue(
        failedEmailRow({ channel: 'IN_APP', body_sha256: null }),
      );

      await expect(service.replay([ROW_ID], NOW)).resolves.toEqual({
        replayed: [ROW_ID],
        refused: [],
      });
    });
  });

  describe('a row it refuses', () => {
    it.each([
      ['is not in this tenant', null, 'NOT_FOUND'],
      ['is not FAILED', failedEmailRow({ status: 'ACCEPTED' }), 'NOT_FAILED'],
      [
        'was suppressed by policy, which replay does not overrule',
        failedEmailRow({ status: 'SUPPRESSED' }),
        'NOT_FAILED',
      ],
      [
        'has had its body purged',
        failedEmailRow({ body_purged_at: new Date('2026-08-01T00:00:00Z') }),
        'BODY_PURGED',
      ],
      [
        'is an email with no stored body hash',
        failedEmailRow({ body_sha256: null }),
        'BODY_MISSING',
      ],
      [
        'is an email whose body was cleared',
        failedEmailRow({ body: null }),
        'BODY_MISSING',
      ],
      [
        'waited longer than the sending window, so the next sweep would fail it again',
        failedEmailRow({
          createdAt: new Date(
            NOW.getTime() - NOTIFICATION_UNSENT_WINDOW_MS - 1000,
          ),
        }),
        'STALE_UNSENT',
      ],
      [
        'is an email whose approval link was removed when it failed',
        failedEmailRow({
          body: `Guten Tag, Ihr Link: ${REDACTED_APPROVAL_LINK}`,
        }),
        'LINK_REDACTED',
      ],
    ])(
      'refuses a row that %s, with %s, and sends nothing',
      async (_label, row, code) => {
        prisma.notificationOutbox.findFirst.mockResolvedValue(row);

        await expect(service.replay([ROW_ID], NOW)).resolves.toEqual({
          replayed: [],
          refused: [{ id: ROW_ID, code }],
        });
        expect(prisma.notificationOutbox.updateMany).not.toHaveBeenCalled();
        expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
      },
    );

    it('refuses a row that another request moved before this write ran', async () => {
      prisma.notificationOutbox.updateMany.mockResolvedValue({ count: 0 });

      await expect(service.replay([ROW_ID], NOW)).resolves.toEqual({
        replayed: [],
        refused: [{ id: ROW_ID, code: 'NOT_FAILED' }],
      });
      expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
    });
  });

  it('splits a mixed batch into replayed and refused, and wakes only the replayed rows', async () => {
    prisma.notificationOutbox.findFirst.mockImplementation(
      ({ where }: { where: { id: string } }) =>
        Promise.resolve(where.id === ROW_ID ? failedEmailRow() : null),
    );

    await expect(service.replay([ROW_ID, OTHER_ID], NOW)).resolves.toEqual({
      replayed: [ROW_ID],
      refused: [{ id: OTHER_ID, code: 'NOT_FOUND' }],
    });
    expect(wakeUps.enqueueWakeUp).toHaveBeenCalledTimes(1);
    expect(wakeUps.enqueueWakeUp).toHaveBeenCalledWith({
      outboxId: ROW_ID,
      tenantId: 'tenant-1',
    });
  });

  it('keeps the row PENDING and still reports it replayed when the wake-up cannot be queued', async () => {
    const warn = jest
      .spyOn(Logger.prototype, 'warn')
      .mockImplementation(() => undefined);
    wakeUps.enqueueWakeUp.mockRejectedValue(
      new Error('queue is not enabled for this project'),
    );

    await expect(service.replay([ROW_ID], NOW)).resolves.toEqual({
      replayed: [ROW_ID],
      refused: [],
    });
    expect(prisma.notificationOutbox.updateMany).toHaveBeenCalledTimes(1);
    // The log names the error class only: the message is not written to the log here.
    expect(warn).toHaveBeenCalledWith(
      `Could not wake replayed notification ${ROW_ID}: Error`,
    );
  });
});
