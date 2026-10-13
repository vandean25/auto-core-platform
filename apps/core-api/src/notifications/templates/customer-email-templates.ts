import type { EmailDraft } from '../notification-outbox.email-columns.js';
import { isSingleLineText } from '../email/header-text.js';

/**
 * Customer messages in the formal German Sie form (ADR-0025 section 6, AUT-360 D16: transactional).
 *
 * The wording is a draft until the lawyer signs it off (AUT-360 D19 and D23). Phase 3 only renders the
 * drafts; nothing sends them. Phase 4 wires the estimate send behind CUSTOMER_ESTIMATE_SEND_ENABLED.
 */

export const CUSTOMER_TEMPLATE_VERSION = 1;

export const CUSTOMER_TEMPLATE_IDS = {
  estimateSent: 'customer.estimate_sent',
  estimateApprovalConfirmed: 'customer.estimate_approval_confirmed',
  orderReady: 'customer.order_ready',
} as const;

const DEFAULT_GREETING = 'Sehr geehrte Damen und Herren';
const CLOSING = 'Mit freundlichen Grüßen';
const CONTACT_SENTENCE = 'Bei Fragen stehen wir Ihnen gerne zur Verfügung.';
const VIENNA = 'Europe/Vienna';

/** The recipient and sender details every customer message shares. */
export interface CustomerMessageContext {
  recipientEmail: string;
  /** The workshop's display name, used in the sign-off. */
  senderName: string;
  replyToEmail?: string | null;
  /** A salutation such as "Sehr geehrte Frau Muster", without the comma. Defaults to the neutral form. */
  greeting?: string | null;
}

export interface EstimateSentInput extends CustomerMessageContext {
  estimateNumber: string;
  vehicleLabel: string;
  /**
   * The link where the customer views and approves the estimate (the phase 4 public route). The message
   * has no attachment (ADR-0025 section 6), so the body points at this link.
   */
  approvalUrl: string;
  /** The instant the estimate expires (valid_until). */
  validUntil: Date;
}

export interface EstimateApprovalConfirmedInput extends CustomerMessageContext {
  estimateNumber: string;
  /** The instant the customer's approval was recorded. */
  approvedAt: Date;
}

export interface OrderReadyInput extends CustomerMessageContext {
  orderNumber: string;
  vehicleLabel: string;
}

export function renderEstimateSentEmail(input: EstimateSentInput): EmailDraft {
  const estimateNumber = requiredText('estimateNumber', input.estimateNumber);
  const vehicleLabel = requiredText('vehicleLabel', input.vehicleLabel);
  const approvalUrl = requiredHttpsUrl('approvalUrl', input.approvalUrl);
  const validUntil = requiredInstant('validUntil', input.validUntil);
  return draft(input, CUSTOMER_TEMPLATE_IDS.estimateSent, {
    subject: `Kostenvoranschlag ${estimateNumber}`,
    paragraphs: [
      `wir haben für Ihr Fahrzeug ${vehicleLabel} den Kostenvoranschlag ${estimateNumber} erstellt.`,
      `Den Kostenvoranschlag können Sie unter folgendem Link einsehen: ${approvalUrl}`,
      `Der Kostenvoranschlag ist gültig bis ${formatValidUntil(validUntil)} Uhr. Bitte prüfen Sie ihn in Ruhe. ${CONTACT_SENTENCE}`,
    ],
  });
}

export function renderEstimateApprovalConfirmedEmail(
  input: EstimateApprovalConfirmedInput,
): EmailDraft {
  const estimateNumber = requiredText('estimateNumber', input.estimateNumber);
  const approvedAt = requiredInstant('approvedAt', input.approvedAt);
  return draft(input, CUSTOMER_TEMPLATE_IDS.estimateApprovalConfirmed, {
    subject: `Bestätigung Ihrer Freigabe: Kostenvoranschlag ${estimateNumber}`,
    paragraphs: [
      `vielen Dank für Ihre Freigabe des Kostenvoranschlags ${estimateNumber} am ${formatDate(approvedAt)}.`,
      `Wir bestätigen Ihre Freigabe hiermit. ${CONTACT_SENTENCE}`,
    ],
  });
}

export function renderOrderReadyEmail(input: OrderReadyInput): EmailDraft {
  const orderNumber = requiredText('orderNumber', input.orderNumber);
  const vehicleLabel = requiredText('vehicleLabel', input.vehicleLabel);
  return draft(input, CUSTOMER_TEMPLATE_IDS.orderReady, {
    subject: `Ihr Fahrzeug ist fertig: Auftrag ${orderNumber}`,
    paragraphs: [
      `die Arbeiten an Ihrem Fahrzeug ${vehicleLabel} sind abgeschlossen. Sie können Ihr Fahrzeug bei uns abholen.`,
      CONTACT_SENTENCE,
    ],
  });
}

/**
 * A value the copy is built from. A blank or multi-line value fails here: the writer would refuse it
 * later, and a line break in a subject would reach the header. The value is written without the spaces
 * around it, so a subject never carries trailing whitespace.
 */
function requiredText(name: string, value: string): string {
  if (value.trim() === '' || !isSingleLineText(value)) {
    throw new Error(
      `Customer message field ${name} must be a non-blank single line`,
    );
  }
  return value.trim();
}

/**
 * A date the copy formats. Intl prints the current time for undefined and 1 January 1970 for null, so a
 * missing or invalid date fails here instead of printing a wrong one.
 */
function requiredInstant(name: string, value: Date): Date {
  if (!(value instanceof Date) || Number.isNaN(value.getTime())) {
    throw new Error(`Customer message field ${name} must be a valid date`);
  }
  return value;
}

/**
 * The estimate link. The message has no attachment, so this link is the only way to the estimate. It must
 * be written as https://host/...: a link without the slashes is not clickable, and one with credentials
 * would put a password into a customer-facing link. Spaces and line breaks are refused before parsing. The
 * link written is the parsed form, so the address the customer opens is the one that was checked.
 */
function requiredHttpsUrl(name: string, value: string): string {
  const message = `Customer message field ${name} must be an absolute https URL without spaces or credentials`;
  if (
    !/^https:\/\//i.test(value) ||
    /\s/.test(value) ||
    !isSingleLineText(value)
  ) {
    throw new Error(message);
  }
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(message);
  }
  if (url.protocol !== 'https:' || url.username !== '' || url.password !== '') {
    throw new Error(message);
  }
  return url.href;
}

function draft(
  input: CustomerMessageContext,
  templateId: string,
  content: { subject: string; paragraphs: string[] },
): EmailDraft {
  const senderName = requiredText('senderName', input.senderName);
  const greeting = input.greeting ?? '';
  const salutation =
    greeting.trim() === ''
      ? DEFAULT_GREETING
      : requiredText('greeting', greeting).replace(/,$/, '');
  return {
    recipientEmail: input.recipientEmail,
    senderName,
    replyToEmail: input.replyToEmail ?? null,
    subject: content.subject,
    text: [
      `${salutation},`,
      ...content.paragraphs,
      `${CLOSING}\n${senderName}`,
    ].join('\n\n'),
    templateId,
    templateVersion: CUSTOMER_TEMPLATE_VERSION,
  };
}

/** "13.10.2026" in business time, as formatWorkshopEstimateDate prints it. The spec keeps them in step. */
function formatDate(instant: Date): string {
  return new Intl.DateTimeFormat('de-AT', {
    timeZone: VIENNA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(instant);
}

/** "27.10.2026, 10:00" in business time, as the estimate PDF prints it (formatWorkshopEstimateValidUntil). */
function formatValidUntil(instant: Date): string {
  return new Intl.DateTimeFormat('de-AT', {
    timeZone: VIENNA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
    hour: '2-digit',
    minute: '2-digit',
  }).format(instant);
}
