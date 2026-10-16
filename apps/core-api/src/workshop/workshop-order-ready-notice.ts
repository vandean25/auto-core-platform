import type { NotificationOutboxStatus } from '@prisma/client';
import {
  buildWorkshopOrderReadyCustomerEmail,
  type ReadyEmailCustomerRefusalCode,
} from './workshop-order-ready-customer-email.js';

export const READY_EMAIL_NOTICE_CODES = [
  'NOT_APPLICABLE',
  'BLOCKED_NO_CUSTOMER',
  'BLOCKED_EMAIL_NOT_CONFIRMED',
  'BLOCKED_EMAIL_MISSING',
  'BLOCKED_EMAIL_INVALID',
  'BLOCKED_VEHICLE_INCOMPLETE',
  'BLOCKED_SELLER_INCOMPLETE',
  'NOT_QUEUED',
  'QUEUED',
  'SENT',
  'FAILED',
  'SUPPRESSED',
] as const;

export type ReadyEmailNoticeCode = (typeof READY_EMAIL_NOTICE_CODES)[number];

export interface WorkshopReadyEmailNotice {
  code: ReadyEmailNoticeCode;
  message: string;
}

const REFUSAL_TO_NOTICE: Record<
  ReadyEmailCustomerRefusalCode,
  ReadyEmailNoticeCode
> = {
  READY_EMAIL_NO_CUSTOMER: 'BLOCKED_NO_CUSTOMER',
  READY_EMAIL_NOT_CONFIRMED: 'BLOCKED_EMAIL_NOT_CONFIRMED',
  READY_EMAIL_MISSING: 'BLOCKED_EMAIL_MISSING',
  READY_EMAIL_INVALID: 'BLOCKED_EMAIL_INVALID',
  READY_EMAIL_INCOMPLETE: 'BLOCKED_VEHICLE_INCOMPLETE',
};

const NOTICE_MESSAGES: Record<ReadyEmailNoticeCode, string> = {
  NOT_APPLICABLE: 'Ready notice does not apply to this order.',
  BLOCKED_NO_CUSTOMER:
    'Assign a customer before a ready notice can be emailed.',
  BLOCKED_EMAIL_NOT_CONFIRMED:
    'Confirm the customer email for order communication before sending the ready notice.',
  BLOCKED_EMAIL_MISSING:
    'The customer has no email address for the ready notice.',
  BLOCKED_EMAIL_INVALID: 'The customer email address is not valid for sending.',
  BLOCKED_VEHICLE_INCOMPLETE:
    'The vehicle needs a make and model for the ready notice.',
  BLOCKED_SELLER_INCOMPLETE:
    'Seller identity is incomplete; the ready notice cannot be sent.',
  NOT_QUEUED:
    'No ready notice was queued. Fix the contact details and use Resend, or complete the order again after they are set.',
  QUEUED: 'The ready notice is queued for delivery.',
  SENT: 'The ready notice was sent.',
  FAILED: 'The ready notice could not be delivered.',
  SUPPRESSED: 'The ready notice was not sent.',
};

export function readyEmailNoticeMessage(code: ReadyEmailNoticeCode): string {
  return NOTICE_MESSAGES[code];
}

function deliveryNotice(
  status: NotificationOutboxStatus,
): WorkshopReadyEmailNotice {
  const code =
    status === 'PENDING' || status === 'SENDING'
      ? 'QUEUED'
      : status === 'ACCEPTED'
        ? 'SENT'
        : status === 'FAILED'
          ? 'FAILED'
          : 'SUPPRESSED';
  return { code, message: readyEmailNoticeMessage(code) };
}

export interface ReadyEmailNoticeInput {
  orderStatus: string;
  purpose: string;
  customer: {
    id: string;
    contact_email_ok: boolean;
    email: string | null;
  } | null;
  vehicle: { make: string; model: string };
  sellerName: string;
  sellerReady: boolean;
  latestReadyEmailStatus: NotificationOutboxStatus | null;
}

/** What advisors see on a completed customer-repair order about the ready email. */
export function resolveReadyEmailNotice(
  input: ReadyEmailNoticeInput,
): WorkshopReadyEmailNotice | null {
  if (input.orderStatus !== 'COMPLETED') {
    return null;
  }
  if (input.purpose !== 'CUSTOMER_REPAIR') {
    return {
      code: 'NOT_APPLICABLE',
      message: readyEmailNoticeMessage('NOT_APPLICABLE'),
    };
  }
  if (!input.sellerReady) {
    return {
      code: 'BLOCKED_SELLER_INCOMPLETE',
      message: readyEmailNoticeMessage('BLOCKED_SELLER_INCOMPLETE'),
    };
  }
  if (input.latestReadyEmailStatus !== null) {
    return deliveryNotice(input.latestReadyEmailStatus);
  }
  const built = buildWorkshopOrderReadyCustomerEmail({
    customer: input.customer,
    vehicle: input.vehicle,
    sellerName: input.sellerName,
    orderNumber: 'WO-0000',
  });
  if (!built.ok) {
    const code = REFUSAL_TO_NOTICE[built.code];
    return { code, message: built.message };
  }
  return {
    code: 'NOT_QUEUED',
    message: readyEmailNoticeMessage('NOT_QUEUED'),
  };
}
