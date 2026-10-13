import type { EmailDraft } from '../notification-outbox.email-columns.js';

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
  /** A full salutation such as "Sehr geehrte Frau Muster". Defaults to the neutral form. */
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
  return draft(input, CUSTOMER_TEMPLATE_IDS.estimateSent, {
    subject: `Kostenvoranschlag ${estimateNumber}`,
    paragraphs: [
      `wir haben für Ihr Fahrzeug ${vehicleLabel} den Kostenvoranschlag ${estimateNumber} erstellt.`,
      `Den Kostenvoranschlag können Sie unter folgendem Link einsehen: ${approvalUrl}`,
      `Der Kostenvoranschlag ist gültig bis ${formatValidUntil(input.validUntil)} Uhr. Bitte prüfen Sie ihn in Ruhe. ${CONTACT_SENTENCE}`,
    ],
  });
}

export function renderEstimateApprovalConfirmedEmail(
  input: EstimateApprovalConfirmedInput,
): EmailDraft {
  const estimateNumber = requiredText('estimateNumber', input.estimateNumber);
  return draft(input, CUSTOMER_TEMPLATE_IDS.estimateApprovalConfirmed, {
    subject: `Bestätigung Ihrer Freigabe: Kostenvoranschlag ${estimateNumber}`,
    paragraphs: [
      `vielen Dank für Ihre Freigabe des Kostenvoranschlags ${estimateNumber} am ${formatDate(input.approvedAt)}.`,
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

/** A value the copy is built from. A blank one fails here rather than reaching a customer. */
function requiredText(name: string, value: string): string {
  if (value.trim() === '') {
    throw new Error(`Customer message field ${name} must not be blank`);
  }
  return value;
}

/** The estimate link. The message has no attachment, so this link is the only way to the estimate. */
function requiredHttpsUrl(name: string, value: string): string {
  try {
    if (new URL(value).protocol === 'https:') {
      return value;
    }
  } catch {
    // Not an absolute URL: refused below.
  }
  throw new Error(
    `Customer message field ${name} must be an absolute https URL`,
  );
}

function draft(
  input: CustomerMessageContext,
  templateId: string,
  content: { subject: string; paragraphs: string[] },
): EmailDraft {
  const salutation = input.greeting?.trim() || DEFAULT_GREETING;
  return {
    recipientEmail: input.recipientEmail,
    senderName: input.senderName,
    replyToEmail: input.replyToEmail ?? null,
    subject: content.subject,
    text: [
      `${salutation},`,
      ...content.paragraphs,
      `${CLOSING}\n${input.senderName}`,
    ].join('\n\n'),
    templateId,
    templateVersion: CUSTOMER_TEMPLATE_VERSION,
  };
}

/** "13.10.2026" in business time. */
function formatDate(instant: Date): string {
  return new Intl.DateTimeFormat('de-AT', {
    timeZone: VIENNA,
    day: '2-digit',
    month: '2-digit',
    year: 'numeric',
  }).format(instant);
}

/** "27.10.2026, 10:00" in business time; the printed cut-off carries the time, as on the estimate PDF. */
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
