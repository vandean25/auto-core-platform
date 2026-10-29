import { NotificationEventType, type DisplayLanguage } from '@prisma/client';

/**
 * What a device receives (ADR-0033 §6). Only these keys ever leave the server, and none of them carries customer data:
 * a generic localized title and body, the event, the order id for the deep link and a tag for collapsing.
 */
export const PUSH_DATA_KEYS = [
  'title',
  'body',
  'eventType',
  'orderId',
  'url',
  'tag',
] as const;

export type PushData = Partial<Record<(typeof PUSH_DATA_KEYS)[number], string>>;

export interface PushMessageInput {
  eventType: NotificationEventType;
  locale: DisplayLanguage;
  orderId: string | null;
  orderNumber: string | null;
  /** Tenant and site of the order. They go into the link as routing hints; the app still switches through its authorized flow. */
  tenantId: string;
  siteId: string | null;
  /** From the outbox payload of CUSTOMER_ESTIMATE_DECIDED: the title says approved or declined. */
  decision: 'APPROVED' | 'DECLINED' | null;
}

interface Texts {
  title: string;
  /** `{order}` is replaced with "Auftrag WO-1" / "Order WO-1", or the text for no order. */
  body: string;
}

const TEXTS: Record<DisplayLanguage, Record<string, Texts>> = {
  de: {
    estimateDecided: {
      title: 'Kostenvoranschlag entschieden',
      body: '{order}',
    },
    estimateApproved: {
      title: 'Kostenvoranschlag freigegeben',
      body: '{order}',
    },
    estimateDeclined: {
      title: 'Kostenvoranschlag abgelehnt',
      body: '{order}',
    },
    waitingCustomer: { title: 'Wartet auf den Kunden', body: '{order}' },
    orderReady: { title: 'Auftrag fertig', body: '{order}' },
    test: {
      title: 'Testbenachrichtigung',
      body: 'Push ist auf diesem Gerät aktiv.',
    },
  },
  en: {
    estimateDecided: { title: 'Estimate decided', body: '{order}' },
    estimateApproved: { title: 'Estimate approved', body: '{order}' },
    estimateDeclined: { title: 'Estimate declined', body: '{order}' },
    waitingCustomer: { title: 'Waiting for the customer', body: '{order}' },
    orderReady: { title: 'Order ready', body: '{order}' },
    test: {
      title: 'Test notification',
      body: 'Push is active on this device.',
    },
  },
};

const ORDER_LABEL: Record<DisplayLanguage, string> = {
  de: 'Auftrag',
  en: 'Order',
};

function textKey(input: PushMessageInput): string | null {
  switch (input.eventType) {
    case NotificationEventType.CUSTOMER_ESTIMATE_DECIDED:
      if (input.decision === 'APPROVED') return 'estimateApproved';
      if (input.decision === 'DECLINED') return 'estimateDeclined';
      return 'estimateDecided';
    case NotificationEventType.WORKSHOP_TASK_WAITING_CUSTOMER:
      return 'waitingCustomer';
    case NotificationEventType.WORKSHOP_ORDER_READY:
      return 'orderReady';
    case NotificationEventType.PUSH_TEST:
      return 'test';
    default:
      return null;
  }
}

/** Query parameters of the order link. The app reads them, switches tenant and site through the authorized flow, then drops them. */
export const PUSH_LINK_TENANT_PARAM = 'pushTenant';
export const PUSH_LINK_SITE_PARAM = 'pushSite';

/**
 * `/workshop/orders/{id}` with the tenant and site the order lives in. The detail API only finds an order in the
 * active tenant and site, so a recipient who works in another context needs it. The ids are routing hints, never
 * authorization: the switch is validated by the server against the user's memberships.
 */
function buildOrderLink(
  orderId: string,
  tenantId: string,
  siteId: string | null,
): string {
  const params = new URLSearchParams({ [PUSH_LINK_TENANT_PARAM]: tenantId });
  if (siteId) params.set(PUSH_LINK_SITE_PARAM, siteId);
  return `/workshop/orders/${orderId}?${params.toString()}`;
}

/** The data message for one push, or null for an event that has no push text. */
export function buildPushMessage(input: PushMessageInput): PushData | null {
  const key = textKey(input);
  if (!key) return null;
  const texts = TEXTS[input.locale][key];
  const orderText = input.orderNumber
    ? `${ORDER_LABEL[input.locale]} ${input.orderNumber}`
    : '';
  const data: PushData = {
    title: texts.title,
    body: texts.body.replace('{order}', orderText).trim() || texts.title,
    eventType: input.eventType,
    tag: input.orderId
      ? `${input.eventType}:${input.orderId}`
      : input.eventType,
  };
  if (input.orderId) {
    data.orderId = input.orderId;
    data.url = buildOrderLink(input.orderId, input.tenantId, input.siteId);
  }
  return data;
}
