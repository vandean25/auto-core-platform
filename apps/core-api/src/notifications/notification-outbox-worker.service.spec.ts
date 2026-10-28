import { EmailProviderError } from './email/email-provider.js';
import {
  NOTIFICATION_CLAIM_TOLERANCE_MS,
  NOTIFICATION_PROVIDER_TIMEOUT_MS,
  NotificationOutboxWorkerService,
} from './notification-outbox-worker.service.js';
import type { NotificationDeliveryConfig } from './notification-delivery.config.js';
import {
  NOTIFICATION_MAX_ATTEMPTS,
  NOTIFICATION_UNSENT_WINDOW_MS,
} from './notification-retry.policy.js';

const NOW = new Date('2026-10-12T08:00:00.000Z');
const LIVE_OFF: NotificationDeliveryConfig = {
  mode: 'fake',
  liveProvider: 'brevo',
  allowlist: [],
  fromAddress: 'kontakt@example.at',
};

function makeRow(overrides: Record<string, unknown> = {}) {
  return {
    channel: 'EMAIL',
    event_type: 'WORKSHOP_TASK_WAITING_CUSTOMER',
    recipient_email: 'kunde@example.at',
    subject: 'Auftrag Nr. 1',
    body: 'Guten Tag,',
    sender_name: 'Werkstatt',
    reply_to_email: null,
    attempts: 1,
    ...overrides,
  };
}

describe('NotificationOutboxWorkerService', () => {
  let prisma: {
    notificationOutbox: { updateMany: jest.Mock; findFirst: jest.Mock };
    customer: { findFirst: jest.Mock; updateMany: jest.Mock };
  };
  let provider: { name: string; send: jest.Mock };
  let providers: { resolve: jest.Mock };
  let wakeUps: { enqueueWakeUp: jest.Mock };
  let systemPrisma: { tenant: { findFirst: jest.Mock } };
  let push: { deliver: jest.Mock };
  let service: NotificationOutboxWorkerService;

  /** Claim succeeds, the row is found, and the final write succeeds unless a test overrides it. */
  function arrange(row = makeRow(), writes: { count: number }[] = []) {
    prisma.notificationOutbox.updateMany
      .mockResolvedValueOnce({ count: 1 })
      .mockResolvedValue({ count: 1 });
    writes.forEach((write, index) =>
      prisma.notificationOutbox.updateMany
        .mockResolvedValueOnce(write)
        .mockName(`write-${index}`),
    );
    prisma.notificationOutbox.findFirst.mockResolvedValue(row);
  }

  /** The data written by the outcome call (the second updateMany). */
  const outcome = () =>
    prisma.notificationOutbox.updateMany.mock.calls[1][0].data;

  beforeEach(() => {
    prisma = {
      notificationOutbox: { updateMany: jest.fn(), findFirst: jest.fn() },
      customer: {
        findFirst: jest.fn().mockResolvedValue({ email: 'kunde@example.at' }),
        updateMany: jest.fn(),
      },
    };
    provider = {
      name: 'fake',
      send: jest.fn().mockResolvedValue({ providerMessageId: 'fake-1' }),
    };
    providers = { resolve: jest.fn().mockReturnValue(provider) };
    wakeUps = { enqueueWakeUp: jest.fn().mockResolvedValue(undefined) };
    systemPrisma = {
      tenant: { findFirst: jest.fn().mockResolvedValue({ is_active: true }) },
    };
    push = { deliver: jest.fn() };
    service = new NotificationOutboxWorkerService(
      prisma as never,
      providers as never,
      wakeUps as never,
      systemPrisma as never,
      push as never,
    );
  });

  describe('PUSH rows (ADR-0033)', () => {
    const pushRow = () =>
      makeRow({
        channel: 'PUSH',
        event_type: 'CUSTOMER_ESTIMATE_DECIDED',
        recipient_user_id: 'user-1',
        workshop_order_id: 'order-1',
        createdAt: new Date('2026-10-12T07:59:00.000Z'),
        recipient_email: null,
        subject: null,
        body: null,
        sender_name: null,
        payload: { decision: 'APPROVED' },
      });

    it('hands the row to the push sender and never to an email provider', async () => {
      arrange(pushRow());
      push.deliver.mockResolvedValue({ kind: 'accepted', acceptedDevices: 2 });

      await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

      expect(push.deliver).toHaveBeenCalledWith(
        {
          outboxId: 'outbox-1',
          tenantId: 'tenant-1',
          eventType: 'CUSTOMER_ESTIMATE_DECIDED',
          recipientUserId: 'user-1',
          workshopOrderId: 'order-1',
          payload: { decision: 'APPROVED' },
          createdAt: new Date('2026-10-12T07:59:00.000Z'),
        },
        NOW,
      );
      expect(providers.resolve).not.toHaveBeenCalled();
      expect(outcome()).toMatchObject({
        status: 'ACCEPTED',
        provider: 'fcm',
        accepted_at: NOW,
        last_error_code: null,
      });
    });

    it('records a suppressed push with its reason', async () => {
      arrange(pushRow());
      push.deliver.mockResolvedValue({ kind: 'suppressed', reason: 'STALE' });

      await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

      expect(outcome()).toMatchObject({
        status: 'SUPPRESSED',
        suppressed_reason: 'STALE',
      });
    });

    it('schedules a retry for a transient provider failure and fails a row that cannot be sent', async () => {
      arrange(pushRow());
      push.deliver.mockResolvedValue({
        kind: 'retry',
        code: 'PUSH_PROVIDER_UNAVAILABLE',
        message: 'The push provider did not accept the message',
      });

      await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

      expect(outcome()).toMatchObject({
        status: 'PENDING',
        last_error_code: 'PUSH_PROVIDER_UNAVAILABLE',
      });
      expect(wakeUps.enqueueWakeUp).toHaveBeenCalledTimes(1);

      prisma.notificationOutbox.updateMany.mockReset();
      wakeUps.enqueueWakeUp.mockClear();
      arrange(pushRow());
      push.deliver.mockResolvedValue({
        kind: 'failed',
        code: 'RECIPIENT_MISSING',
        message: 'The outbox row has no recipient user',
      });

      await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

      expect(outcome()).toMatchObject({
        status: 'FAILED',
        last_error_code: 'RECIPIENT_MISSING',
      });
      expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
    });
  });

  it('records ACCEPTED with the provider id and clears the previous error', async () => {
    arrange();

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(provider.send).toHaveBeenCalledWith(
      expect.objectContaining({
        to: 'kunde@example.at',
        from: { email: 'kontakt@example.at', name: 'Werkstatt' },
        subject: 'Auftrag Nr. 1',
        text: 'Guten Tag,',
      }),
      expect.objectContaining({ idempotencyKey: 'outbox-1' }),
    );
    expect(outcome()).toMatchObject({
      status: 'ACCEPTED',
      provider: 'fake',
      provider_message_id: 'fake-1',
      accepted_at: NOW,
      last_error_code: null,
    });
    const fenced = prisma.notificationOutbox.updateMany.mock.calls[1][0].where;
    expect(fenced).toMatchObject({
      id: 'outbox-1',
      tenant_id: 'tenant-1',
      status: 'SENDING',
    });
    expect(fenced.lease_token).toEqual(expect.any(String));
    expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
  });

  it('does nothing when the claim matches no due row', async () => {
    prisma.notificationOutbox.updateMany.mockResolvedValueOnce({ count: 0 });

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(prisma.notificationOutbox.updateMany).toHaveBeenCalledTimes(1);
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('suppresses the row while the mode is off, without calling a provider', async () => {
    arrange();

    await service.deliver('outbox-1', 'tenant-1', NOW, {
      ...LIVE_OFF,
      mode: 'off',
    });

    expect(outcome()).toMatchObject({
      status: 'SUPPRESSED',
      suppressed_reason: 'EMAIL_DISABLED',
    });
    expect(providers.resolve).not.toHaveBeenCalled();
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('suppresses a live send to a recipient outside the allowlist', async () => {
    arrange();

    await service.deliver('outbox-1', 'tenant-1', NOW, {
      ...LIVE_OFF,
      mode: 'live',
      allowlist: ['jemand@example.at'],
    });

    expect(outcome()).toMatchObject({
      status: 'SUPPRESSED',
      suppressed_reason: 'RECIPIENT_NOT_ALLOWLISTED',
    });
    expect(provider.send).not.toHaveBeenCalled();
  });

  it('schedules a retry with backoff after a transient failure', async () => {
    arrange(makeRow({ attempts: 1 }));
    provider.send.mockRejectedValueOnce(
      new EmailProviderError('transient', 'NETWORK', 'down'),
    );

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(outcome()).toMatchObject({
      status: 'PENDING',
      next_attempt_at: new Date(NOW.getTime() + 60_000),
      last_error_code: 'NETWORK',
      lease_token: null,
    });
    expect(wakeUps.enqueueWakeUp).toHaveBeenCalledWith({
      outboxId: 'outbox-1',
      tenantId: 'tenant-1',
      delaySeconds: 60,
    });
  });

  it('fails the row once it has used its last attempt', async () => {
    arrange(makeRow({ attempts: 5 }));
    provider.send.mockRejectedValueOnce(
      new EmailProviderError('transient', 'PROVIDER_5XX', 'bad'),
    );

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(outcome()).toMatchObject({
      status: 'FAILED',
      last_error_code: 'MAX_ATTEMPTS_EXCEEDED',
      failed_at: NOW,
    });
    expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
  });

  it('fails a permanent rejection at once, with no retry', async () => {
    arrange();
    provider.send.mockRejectedValueOnce(
      new EmailProviderError(
        'permanent',
        'PROVIDER_NOT_CONFIGURED',
        'not configured',
      ),
    );

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(outcome()).toMatchObject({
      status: 'FAILED',
      last_error_code: 'PROVIDER_NOT_CONFIGURED',
    });
    expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
  });

  it('clears the email confirmation of the customer when the address is permanently refused', async () => {
    arrange(
      makeRow({
        recipient_kind: 'CUSTOMER',
        payload: { customer_id: 'customer-1' },
      }),
    );
    provider.send.mockRejectedValueOnce(
      new EmailProviderError(
        'recipient_rejected',
        'RECIPIENT_REJECTED',
        'refused',
      ),
    );

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(outcome()).toMatchObject({
      status: 'FAILED',
      last_error_code: 'RECIPIENT_REJECTED',
    });
    expect(prisma.customer.updateMany).toHaveBeenCalledWith({
      where: {
        id: 'customer-1',
        tenant_id: 'tenant-1',
        email: 'kunde@example.at',
      },
      data: { contact_email_ok: false },
    });
    expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
  });

  it('keeps the email confirmation when the provider fails for a reason other than the address', async () => {
    arrange(
      makeRow({
        recipient_kind: 'CUSTOMER',
        payload: { customer_id: 'customer-1' },
      }),
    );
    provider.send.mockRejectedValueOnce(
      new EmailProviderError(
        'permanent',
        'PROVIDER_NOT_CONFIGURED',
        'not configured',
      ),
    );

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(prisma.customer.updateMany).not.toHaveBeenCalled();
  });

  it('redacts the approval link from the body once the row is accepted', async () => {
    arrange(
      makeRow({
        body: 'Den Kostenvoranschlag können Sie unter folgendem Link einsehen: https://portal.example.at/approve/abc_DEF-123',
      }),
    );

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(outcome()).toMatchObject({
      status: 'ACCEPTED',
      body: 'Den Kostenvoranschlag können Sie unter folgendem Link einsehen: [Link entfernt]',
    });
  });

  it('keeps the approval link in the body while a retry is still pending', async () => {
    arrange(
      makeRow({
        body: 'Den Kostenvoranschlag können Sie unter folgendem Link einsehen: https://portal.example.at/approve/abc_DEF-123',
      }),
    );
    provider.send.mockRejectedValueOnce(
      new EmailProviderError('transient', 'NETWORK', 'down'),
    );

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(outcome()).toMatchObject({ status: 'PENDING' });
    expect(outcome()).not.toHaveProperty('body');
  });

  it('treats an unknown provider error as transient and stores no provider text', async () => {
    arrange();
    provider.send.mockRejectedValueOnce(
      new Error('raw provider body with secrets'),
    );

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(outcome()).toMatchObject({
      status: 'PENDING',
      last_error_code: 'UNEXPECTED_ERROR',
      last_error_message: 'Unexpected sender error',
    });
  });

  it('retries when the sender identity is missing, rather than sending without it', async () => {
    arrange();

    await service.deliver('outbox-1', 'tenant-1', NOW, {
      ...LIVE_OFF,
      fromAddress: '',
    });

    expect(provider.send).not.toHaveBeenCalled();
    expect(outcome()).toMatchObject({
      status: 'PENDING',
      last_error_code: 'SENDER_NOT_CONFIGURED',
    });
  });

  it('fails a non-email row, because nothing can send it', async () => {
    arrange(makeRow({ channel: 'IN_APP' }));

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(outcome()).toMatchObject({
      status: 'FAILED',
      last_error_code: 'UNSUPPORTED_CHANNEL',
    });
  });

  it('schedules no retry when its lease was lost, and writes nothing more', async () => {
    arrange(makeRow(), [{ count: 0 }]);
    provider.send.mockRejectedValueOnce(
      new EmailProviderError('transient', 'NETWORK', 'down'),
    );

    await expect(
      service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF),
    ).resolves.toBeUndefined();

    expect(prisma.notificationOutbox.updateMany).toHaveBeenCalledTimes(2);
    expect(
      prisma.notificationOutbox.updateMany.mock.calls[1][0].where,
    ).toMatchObject({
      id: 'outbox-1',
      tenant_id: 'tenant-1',
      status: 'SENDING',
      lease_token: expect.any(String),
    });
    expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
  });

  it('claims only rows that still have attempts left', async () => {
    arrange();

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(
      prisma.notificationOutbox.updateMany.mock.calls[0][0].where,
    ).toMatchObject({ attempts: { lt: NOTIFICATION_MAX_ATTEMPTS } });
  });

  it('fails a row whose sender name is missing at once, because a retry cannot fix it', async () => {
    arrange(makeRow({ sender_name: null }));

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(provider.send).not.toHaveBeenCalled();
    expect(outcome()).toMatchObject({
      status: 'FAILED',
      last_error_code: 'MESSAGE_INCOMPLETE',
    });
  });

  it('fails a row whose sender name is only spaces, since a blank message is incomplete', async () => {
    arrange(makeRow({ sender_name: '  ' }));

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(provider.send).not.toHaveBeenCalled();
    expect(outcome()).toMatchObject({
      status: 'FAILED',
      last_error_code: 'MESSAGE_INCOMPLETE',
    });
  });

  it('fails a row whose subject is empty, since a blank message is incomplete', async () => {
    arrange(makeRow({ subject: '' }));

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(provider.send).not.toHaveBeenCalled();
    expect(outcome()).toMatchObject({
      status: 'FAILED',
      last_error_code: 'MESSAGE_INCOMPLETE',
    });
  });

  it('fails a row whose body is only spaces, since a blank message is incomplete', async () => {
    arrange(makeRow({ body: ' ' }));

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(provider.send).not.toHaveBeenCalled();
    expect(outcome()).toMatchObject({
      status: 'FAILED',
      last_error_code: 'MESSAGE_INCOMPLETE',
    });
  });

  it('fails a recipient that is not one plain address without calling a provider', async () => {
    arrange(
      makeRow({ recipient_email: 'kunde@example.at, victim@evil.example' }),
    );

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(provider.send).not.toHaveBeenCalled();
    expect(outcome()).toMatchObject({
      status: 'FAILED',
      last_error_code: 'RECIPIENT_INVALID',
    });
  });

  it('clears a stale error when a row is suppressed', async () => {
    arrange(makeRow());

    await service.deliver('outbox-1', 'tenant-1', NOW, {
      ...LIVE_OFF,
      mode: 'off',
    });

    expect(outcome()).toMatchObject({
      status: 'SUPPRESSED',
      last_error_code: null,
      last_error_message: null,
    });
  });

  it('fails a row whose subject would break an email header, without calling a provider', async () => {
    arrange(makeRow({ subject: 'Auftrag\r\nBcc: victim@evil.example' }));

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(provider.send).not.toHaveBeenCalled();
    expect(outcome()).toMatchObject({
      status: 'FAILED',
      last_error_code: 'MESSAGE_INVALID',
    });
  });

  it('fails a row whose reply-to is not one plain address', async () => {
    arrange(
      makeRow({ reply_to_email: 'werkstatt@example.at, victim@evil.example' }),
    );

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(provider.send).not.toHaveBeenCalled();
    expect(outcome()).toMatchObject({
      status: 'FAILED',
      last_error_code: 'MESSAGE_INVALID',
    });
  });

  it('claims a retry whose wake-up fired up to the scheduling tolerance early', async () => {
    arrange();

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(
      prisma.notificationOutbox.updateMany.mock.calls[0][0].where.OR[0],
    ).toMatchObject({
      status: 'PENDING',
      next_attempt_at: {
        lte: new Date(NOW.getTime() + NOTIFICATION_CLAIM_TOLERANCE_MS),
      },
    });
  });

  it('claims only rows created inside the sending window, pending or expired alike', async () => {
    arrange();

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(
      prisma.notificationOutbox.updateMany.mock.calls[0][0].where,
    ).toMatchObject({
      createdAt: {
        gte: new Date(NOW.getTime() - NOTIFICATION_UNSENT_WINDOW_MS),
      },
    });
  });

  it.each([[{ is_active: false }], [null]])(
    'leaves a row unclaimed while its tenant is suspended or gone (%j)',
    async (tenant) => {
      systemPrisma.tenant.findFirst.mockResolvedValueOnce(tenant);

      await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

      expect(systemPrisma.tenant.findFirst).toHaveBeenCalledWith({
        where: { id: 'tenant-1' },
        select: { is_active: true },
      });
      expect(prisma.notificationOutbox.updateMany).not.toHaveBeenCalled();
      expect(providers.resolve).not.toHaveBeenCalled();
      expect(provider.send).not.toHaveBeenCalled();
      expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
    },
  );

  it('fails a sender name with a C1 control, which some header parsers read as a line break', async () => {
    arrange(makeRow({ sender_name: 'Werkstatt\u0085Nord' }));

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(provider.send).not.toHaveBeenCalled();
    expect(outcome()).toMatchObject({
      status: 'FAILED',
      last_error_code: 'MESSAGE_INVALID',
    });
  });

  it('stores a short code and a fixed sentence, never the provider text that can name the address', async () => {
    arrange();
    provider.send.mockRejectedValueOnce(
      new EmailProviderError(
        'permanent',
        'BAD_REQUEST',
        'invalid recipient kunde@example.at',
      ),
    );

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(outcome()).toMatchObject({
      status: 'FAILED',
      last_error_code: 'BAD_REQUEST',
      last_error_message: 'The provider refused the message',
    });
  });

  it('replaces a provider code that is not a short upper-case token', async () => {
    arrange();
    provider.send.mockRejectedValueOnce(
      new EmailProviderError(
        'permanent',
        'kunde@example.at refused',
        'refused',
      ),
    );

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(outcome()).toMatchObject({
      status: 'FAILED',
      last_error_code: 'PROVIDER_ERROR',
      last_error_message: 'The provider refused the message',
    });
  });

  it('gives up on a provider that ignores its abort signal, and retries before the lease runs out', async () => {
    jest.useFakeTimers();
    try {
      arrange();
      provider.send.mockReturnValueOnce(new Promise<never>(() => undefined));

      const delivery = service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);
      await jest.advanceTimersByTimeAsync(NOTIFICATION_PROVIDER_TIMEOUT_MS);
      await delivery;
    } finally {
      jest.useRealTimers();
    }

    expect(outcome()).toMatchObject({
      status: 'PENDING',
      last_error_code: 'TIMEOUT',
      last_error_message: 'The provider did not accept the message',
    });
    expect(wakeUps.enqueueWakeUp).toHaveBeenCalledWith({
      outboxId: 'outbox-1',
      tenantId: 'tenant-1',
      delaySeconds: 60,
    });
  });

  it('does not reschedule a send when the accepted status write fails, and writes no retry', async () => {
    arrange();
    prisma.notificationOutbox.updateMany.mockRejectedValue(
      new Error('db down'),
    );

    await expect(
      service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF),
    ).resolves.toBeUndefined();

    expect(provider.send).toHaveBeenCalledTimes(1);
    expect(prisma.notificationOutbox.updateMany).toHaveBeenCalledTimes(4);
    const written = prisma.notificationOutbox.updateMany.mock.calls.map(
      ([arg]) => arg.data,
    );
    expect(written.some((data) => data?.status === 'PENDING')).toBe(false);
    expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
  });

  it('retries the accepted status write until it lands', async () => {
    arrange();
    prisma.notificationOutbox.updateMany.mockRejectedValueOnce(
      new Error('db blip'),
    );

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    // The claim, the failed ACCEPTED write, then the retry that lands.
    expect(prisma.notificationOutbox.updateMany).toHaveBeenCalledTimes(3);
    expect(
      prisma.notificationOutbox.updateMany.mock.calls[2][0].data,
    ).toMatchObject({
      status: 'ACCEPTED',
      provider_message_id: 'fake-1',
    });
    expect(wakeUps.enqueueWakeUp).not.toHaveBeenCalled();
  });

  it('turns an unexpected exception into a retry under the lease', async () => {
    arrange();
    providers.resolve.mockImplementation(() => {
      throw new Error('boom');
    });

    await service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF);

    expect(outcome()).toMatchObject({
      status: 'PENDING',
      last_error_code: 'UNEXPECTED_ERROR',
    });
    expect(wakeUps.enqueueWakeUp).toHaveBeenCalledWith(
      expect.objectContaining({ outboxId: 'outbox-1', tenantId: 'tenant-1' }),
    );
  });
});
