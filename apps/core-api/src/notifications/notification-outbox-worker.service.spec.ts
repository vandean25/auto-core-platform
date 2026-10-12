import { EmailProviderError } from './email/email-provider.js';
import {
  NOTIFICATION_CLAIM_TOLERANCE_MS,
  NotificationOutboxWorkerService,
} from './notification-outbox-worker.service.js';
import type { NotificationDeliveryConfig } from './notification-delivery.config.js';
import { NOTIFICATION_MAX_ATTEMPTS } from './notification-retry.policy.js';

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
  };
  let provider: { name: string; send: jest.Mock };
  let providers: { resolve: jest.Mock };
  let wakeUps: { enqueueWakeUp: jest.Mock };
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
    };
    provider = {
      name: 'fake',
      send: jest.fn().mockResolvedValue({ providerMessageId: 'fake-1' }),
    };
    providers = { resolve: jest.fn().mockReturnValue(provider) };
    wakeUps = { enqueueWakeUp: jest.fn().mockResolvedValue(undefined) };
    service = new NotificationOutboxWorkerService(
      prisma as never,
      providers as never,
      wakeUps as never,
    );
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

  it('does not overwrite a newer attempt when the lease was lost', async () => {
    arrange(makeRow(), [{ count: 0 }]);

    await expect(
      service.deliver('outbox-1', 'tenant-1', NOW, LIVE_OFF),
    ).resolves.toBeUndefined();
    expect(provider.send).toHaveBeenCalledTimes(1);
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
