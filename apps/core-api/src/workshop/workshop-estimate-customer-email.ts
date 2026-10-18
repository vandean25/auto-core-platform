import { createHmac } from 'node:crypto';
import { UnprocessableEntityException } from '@nestjs/common';
import type { DisplayLanguage } from '../common/i18n/display-language.js';
import { resolveCustomerDocumentLanguage } from '../common/i18n/customer-document-language.js';
import { isPlainEmailAddress } from '../notifications/email/email-address.js';
import type { EmailDraft } from '../notifications/notification-outbox.email-columns.js';
import { renderEstimateSentEmail } from '../notifications/templates/customer-email-templates.js';
import { buildApprovalUrl } from './workshop-estimate-approval-token.helpers.js';

export interface CustomerEstimateEmailInput {
  customer: {
    contact_email_ok: boolean;
    email: string | null;
    preferred_language?: DisplayLanguage | null;
  };
  tenantDefaultLocale: DisplayLanguage;
  vehicle: { make: string; model: string };
  /** The seller's name as the estimate prints it. */
  sellerName: string;
  estimateNumber: string;
  /** The parsed base from `parseApprovalBaseUrl`. */
  approvalBaseUrl: string;
  /** The raw approval token. It goes into the link and nowhere else. */
  approvalToken: string;
  validUntil: Date;
}

export interface CustomerEstimateEmail {
  recipientEmail: string;
  draft: EmailDraft;
}

/**
 * The estimate-sent email for one send (ADR-0025 §5, §6 and §8). The advisor must have confirmed the customer's
 * address for order communication, the address must be a plain one, and the vehicle must be named. The copy is
 * the phase 3 draft: summary and link, with no attachment.
 */
/** Confirmed, non-empty plain customer email for estimate delivery. */
export function resolveCustomerEstimateRecipientEmail(customer: {
  contact_email_ok: boolean;
  email: string | null;
}): string {
  if (!customer.contact_email_ok) {
    const code = 'ESTIMATE_CUSTOMER_EMAIL_NOT_CONFIRMED';
    throw new UnprocessableEntityException({
      code,
      message: `${code}: The customer email address must be confirmed for order communication before the estimate is emailed.`,
    });
  }
  const recipientEmail = customer.email?.trim() ?? '';
  if (recipientEmail === '') {
    const code = 'ESTIMATE_CUSTOMER_EMAIL_MISSING';
    throw new UnprocessableEntityException({
      code,
      message: `${code}: The customer has no email address for the estimate.`,
    });
  }
  if (!isPlainEmailAddress(recipientEmail)) {
    const code = 'ESTIMATE_CUSTOMER_EMAIL_INVALID';
    throw new UnprocessableEntityException({
      code,
      message: `${code}: The customer email address is not a plain address.`,
    });
  }
  return recipientEmail;
}

function estimateRecipientPinSecret(): string {
  const dedicated = process.env.ESTIMATE_RECIPIENT_PIN_SECRET?.trim();
  if (dedicated) {
    return dedicated;
  }
  const fallback = process.env.SECRET_ENCRYPTION_KEY?.trim();
  if (fallback) {
    return fallback;
  }
  if (process.env.NODE_ENV === 'test') {
    return 'test-estimate-recipient-pin-secret';
  }
  throw new Error(
    'ESTIMATE_RECIPIENT_PIN_SECRET or SECRET_ENCRYPTION_KEY is required to pin estimate recipients',
  );
}

/**
 * HMAC pin for the customer email at propose time (tenant + customer id + normalized address).
 * Stored on proposals instead of the raw address.
 */
export function pinCustomerEstimateRecipientEmail(
  tenantId: string,
  customerId: string,
  email: string,
): string {
  const normalized = email.trim().toLowerCase();
  return createHmac('sha256', estimateRecipientPinSecret())
    .update(`${tenantId}:${customerId}:${normalized}`)
    .digest('hex');
}

export function buildCustomerEstimateEmail(
  input: CustomerEstimateEmailInput,
): CustomerEstimateEmail {
  const recipientEmail = resolveCustomerEstimateRecipientEmail(input.customer);
  const make = input.vehicle.make.trim();
  const model = input.vehicle.model.trim();
  if (make === '' || model === '') {
    throw new UnprocessableEntityException({
      code: 'ESTIMATE_VEHICLE_INCOMPLETE',
      message: 'The vehicle needs a make and a model for the estimate email.',
    });
  }
  const vehicleLabel = `${make} ${model}`;
  const documentLocale = resolveCustomerDocumentLanguage(
    {
      preferred_language: input.customer.preferred_language ?? null,
    },
    input.tenantDefaultLocale,
  );

  try {
    const draft = renderEstimateSentEmail({
      recipientEmail,
      senderName: input.sellerName,
      estimateNumber: input.estimateNumber,
      vehicleLabel,
      approvalUrl: buildApprovalUrl(input.approvalBaseUrl, input.approvalToken),
      validUntil: input.validUntil,
      documentLocale,
    });
    return { recipientEmail, draft };
  } catch {
    // The renderer names the field that failed, but not its value, so the stored and returned text stays generic.
    throw new UnprocessableEntityException({
      code: 'ESTIMATE_EMAIL_INCOMPLETE',
      message:
        'The estimate email cannot be written from the seller and order details.',
    });
  }
}
