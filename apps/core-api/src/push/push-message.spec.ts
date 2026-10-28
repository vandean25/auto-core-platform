import { NotificationEventType } from '@prisma/client';
import {
  buildPushMessage,
  PUSH_DATA_KEYS,
  type PushMessageInput,
} from './push-message.js';

const base: PushMessageInput = {
  eventType: NotificationEventType.CUSTOMER_ESTIMATE_DECIDED,
  locale: 'de',
  orderId: 'order-1',
  orderNumber: 'WO-2026-0007',
  decision: 'APPROVED',
};

describe('push message', () => {
  it('says approved or declined in the language of the recipient', () => {
    expect(buildPushMessage(base)).toMatchObject({
      title: 'Kostenvoranschlag freigegeben',
      body: 'Auftrag WO-2026-0007',
    });
    expect(
      buildPushMessage({ ...base, locale: 'en', decision: 'DECLINED' }),
    ).toMatchObject({
      title: 'Estimate declined',
      body: 'Order WO-2026-0007',
    });
    expect(buildPushMessage({ ...base, decision: null })).toMatchObject({
      title: 'Kostenvoranschlag entschieden',
    });
  });

  it('links to the order and collapses per event and order', () => {
    const message = buildPushMessage(base);
    expect(message).toMatchObject({
      orderId: 'order-1',
      url: '/workshop/orders/order-1',
      tag: 'CUSTOMER_ESTIMATE_DECIDED:order-1',
    });
  });

  it('covers the other v1 events and the test push', () => {
    expect(
      buildPushMessage({
        ...base,
        eventType: NotificationEventType.WORKSHOP_TASK_WAITING_CUSTOMER,
        decision: null,
      })?.title,
    ).toBe('Wartet auf den Kunden');
    expect(
      buildPushMessage({
        ...base,
        eventType: NotificationEventType.WORKSHOP_ORDER_READY,
        locale: 'en',
        decision: null,
      })?.title,
    ).toBe('Order ready');
    expect(
      buildPushMessage({
        ...base,
        eventType: NotificationEventType.PUSH_TEST,
        orderId: null,
        orderNumber: null,
        decision: null,
      }),
    ).toEqual({
      title: 'Testbenachrichtigung',
      body: 'Push ist auf diesem Gerät aktiv.',
      eventType: 'PUSH_TEST',
      tag: 'PUSH_TEST',
    });
  });

  it('has no text for an event that is not pushed', () => {
    expect(
      buildPushMessage({
        ...base,
        eventType: NotificationEventType.CUSTOMER_ESTIMATE_SENT,
      }),
    ).toBeNull();
  });

  it('carries only the allowlisted keys and no customer data', () => {
    for (const eventType of [
      NotificationEventType.CUSTOMER_ESTIMATE_DECIDED,
      NotificationEventType.WORKSHOP_TASK_WAITING_CUSTOMER,
      NotificationEventType.WORKSHOP_ORDER_READY,
      NotificationEventType.PUSH_TEST,
    ]) {
      for (const locale of ['de', 'en'] as const) {
        const message = buildPushMessage({ ...base, eventType, locale });
        expect(message).not.toBeNull();
        for (const key of Object.keys(message!)) {
          expect(PUSH_DATA_KEYS).toContain(key);
        }
        const text = JSON.stringify(message);
        expect(text).not.toMatch(/@|\+\d{6,}|Mustermann|W-12345/);
      }
    }
  });
});
