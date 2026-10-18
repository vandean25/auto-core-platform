import type { DisplayLanguage } from '../common/i18n/display-language.js';
import { resolveCustomerDocumentLanguage } from '../common/i18n/customer-document-language.js';
import { isPlainEmailAddress } from '../notifications/email/email-address.js';
import type { EmailDraft } from '../notifications/notification-outbox.email-columns.js';
import { renderOrderReadyEmail } from '../notifications/templates/customer-email-templates.js';

export type ReadyEmailCustomerRefusalCode =
  | 'READY_EMAIL_NO_CUSTOMER'
  | 'READY_EMAIL_NOT_CONFIRMED'
  | 'READY_EMAIL_MISSING'
  | 'READY_EMAIL_INVALID'
  | 'READY_EMAIL_INCOMPLETE';

export interface ReadyEmailCustomerInput {
  customer: {
    id: string;
    contact_email_ok: boolean;
    email: string | null;
    preferred_language?: DisplayLanguage | null;
  } | null;
  vehicle: { make: string; model: string };
  sellerName: string;
  orderNumber: string;
  tenantDefaultLocale: DisplayLanguage;
}

export type ReadyEmailCustomerBuildResult =
  | { ok: true; recipientEmail: string; draft: EmailDraft }
  | { ok: false; code: ReadyEmailCustomerRefusalCode; message: string };

export function buildWorkshopOrderReadyCustomerEmail(
  input: ReadyEmailCustomerInput,
): ReadyEmailCustomerBuildResult {
  if (!input.customer) {
    return {
      ok: false,
      code: 'READY_EMAIL_NO_CUSTOMER',
      message: 'The workshop order has no customer for the ready notice.',
    };
  }
  if (!input.customer.contact_email_ok) {
    return {
      ok: false,
      code: 'READY_EMAIL_NOT_CONFIRMED',
      message:
        'The customer email address must be confirmed for order communication before the ready notice is sent.',
    };
  }
  const recipientEmail = input.customer.email?.trim() ?? '';
  if (recipientEmail === '') {
    return {
      ok: false,
      code: 'READY_EMAIL_MISSING',
      message: 'The customer has no email address for the ready notice.',
    };
  }
  if (!isPlainEmailAddress(recipientEmail)) {
    return {
      ok: false,
      code: 'READY_EMAIL_INVALID',
      message: 'The customer email address is not a plain address.',
    };
  }
  const make = input.vehicle.make.trim();
  const model = input.vehicle.model.trim();
  if (make === '' || model === '') {
    return {
      ok: false,
      code: 'READY_EMAIL_INCOMPLETE',
      message: 'The vehicle needs a make and a model for the ready notice.',
    };
  }
  const documentLocale = resolveCustomerDocumentLanguage(
    {
      preferred_language: input.customer.preferred_language ?? null,
    },
    input.tenantDefaultLocale,
  );
  try {
    const draft = renderOrderReadyEmail({
      recipientEmail,
      senderName: input.sellerName,
      orderNumber: input.orderNumber,
      vehicleLabel: `${make} ${model}`,
      documentLocale,
    });
    return { ok: true, recipientEmail, draft };
  } catch {
    return {
      ok: false,
      code: 'READY_EMAIL_INCOMPLETE',
      message:
        'The ready notice cannot be written from the seller and order details.',
    };
  }
}
