import { UnprocessableEntityException } from '@nestjs/common';
import { isPlainEmailAddress } from '../notifications/email/email-address.js';
import type { EmailDraft } from '../notifications/notification-outbox.email-columns.js';
import { renderEstimateSentEmail } from '../notifications/templates/customer-email-templates.js';
import { buildApprovalUrl } from './workshop-estimate-approval-token.helpers.js';

export interface CustomerEstimateEmailInput {
  customer: { contact_email_ok: boolean; email: string | null };
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
    throw new UnprocessableEntityException({
      code: 'ESTIMATE_CUSTOMER_EMAIL_NOT_CONFIRMED',
      message:
        'The customer email address must be confirmed for order communication before the estimate is emailed.',
    });
  }
  const recipientEmail = customer.email?.trim() ?? '';
  if (recipientEmail === '') {
    throw new UnprocessableEntityException({
      code: 'ESTIMATE_CUSTOMER_EMAIL_MISSING',
      message: 'The customer has no email address for the estimate.',
    });
  }
  if (!isPlainEmailAddress(recipientEmail)) {
    throw new UnprocessableEntityException({
      code: 'ESTIMATE_CUSTOMER_EMAIL_INVALID',
      message: 'The customer email address is not a plain address.',
    });
  }
  return recipientEmail;
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

  try {
    const draft = renderEstimateSentEmail({
      recipientEmail,
      senderName: input.sellerName,
      estimateNumber: input.estimateNumber,
      vehicleLabel,
      approvalUrl: buildApprovalUrl(input.approvalBaseUrl, input.approvalToken),
      validUntil: input.validUntil,
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
