import type { BatchResponse, Messaging } from 'firebase-admin/messaging';
import {
  classifyFcmError,
  FirebasePushMessagingGateway,
  toOutcomes,
  toSafeProviderCode,
} from './push-messaging.gateway.js';

const targets = [
  { deviceId: 'd1', token: 'token-1' },
  { deviceId: 'd2', token: 'token-2' },
  { deviceId: 'd3', token: 'token-3' },
];

describe('push messaging gateway', () => {
  it('marks a dead token, keeps invalid-argument apart and retries everything else', () => {
    expect(
      classifyFcmError('messaging/registration-token-not-registered'),
    ).toBe('unregistered');
    expect(classifyFcmError('messaging/invalid-registration-token')).toBe(
      'unregistered',
    );
    expect(classifyFcmError('messaging/invalid-argument')).toBe(
      'invalid-argument',
    );
    expect(classifyFcmError('messaging/server-unavailable')).toBe('transient');
    expect(classifyFcmError('messaging/internal-error')).toBe('transient');
    expect(classifyFcmError('messaging/third-party-auth-error')).toBe(
      'transient',
    );
    expect(classifyFcmError(undefined)).toBe('transient');
  });

  it('keeps only a short provider code', () => {
    expect(toSafeProviderCode('messaging/server-unavailable')).toBe(
      'messaging/server-unavailable',
    );
    expect(
      toSafeProviderCode('The token abc123 for max@example.at failed'),
    ).toBe('messaging/unknown');
    expect(toSafeProviderCode(undefined)).toBe('messaging/unknown');
  });

  it('maps each response to its device', () => {
    const response = {
      successCount: 1,
      failureCount: 2,
      responses: [
        { success: true },
        {
          success: false,
          error: { code: 'messaging/registration-token-not-registered' },
        },
        { success: false, error: { code: 'messaging/server-unavailable' } },
      ],
    } as unknown as BatchResponse;

    expect(toOutcomes(targets, response)).toEqual([
      { deviceId: 'd1', ok: true },
      {
        deviceId: 'd2',
        ok: false,
        kind: 'unregistered',
        code: 'messaging/registration-token-not-registered',
      },
      {
        deviceId: 'd3',
        ok: false,
        kind: 'transient',
        code: 'messaging/server-unavailable',
      },
    ]);
  });

  it('sends data-only messages with a one hour time to live through firebase-admin', async () => {
    const sendEach = jest.fn().mockResolvedValue({
      successCount: 3,
      failureCount: 0,
      responses: [{ success: true }, { success: true }, { success: true }],
    });
    class TestGateway extends FirebasePushMessagingGateway {
      protected override messaging(): Messaging {
        return { sendEach } as unknown as Messaging;
      }
    }

    const outcomes = await new TestGateway().sendEach(targets, {
      title: 'T',
      body: 'B',
      eventType: 'PUSH_TEST',
      tag: 'PUSH_TEST',
    });

    expect(outcomes.every((outcome) => outcome.ok)).toBe(true);
    const messages = sendEach.mock.calls[0][0] as Array<
      Record<string, unknown>
    >;
    expect(messages).toHaveLength(3);
    expect(messages[0]).toEqual({
      token: 'token-1',
      data: { title: 'T', body: 'B', eventType: 'PUSH_TEST', tag: 'PUSH_TEST' },
      webpush: { headers: { TTL: '3600', Urgency: 'normal' } },
    });
    expect(messages[0]).not.toHaveProperty('notification');
  });

  it('sends nothing for no device', async () => {
    const sendEach = jest.fn();
    class TestGateway extends FirebasePushMessagingGateway {
      protected override messaging(): Messaging {
        return { sendEach } as unknown as Messaging;
      }
    }
    await expect(
      new TestGateway().sendEach([], { title: 'T' }),
    ).resolves.toEqual([]);
    expect(sendEach).not.toHaveBeenCalled();
  });
});
