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
  return draft(input, CUSTOMER_TEMPLATE_IDS.estimateSent, {
    subject: `Kostenvoranschlag ${input.estimateNumber}`,
    paragraphs: [
      `wir haben für Ihr Fahrzeug ${input.vehicleLabel} den Kostenvoranschlag ${input.estimateNumber} erstellt.`,
      `Den Kostenvoranschlag können Sie unter folgendem Link einsehen: ${input.approvalUrl}`,
      `Der Kostenvoranschlag ist gültig bis ${formatValidUntil(input.validUntil)} Uhr. Bitte prüfen Sie ihn in Ruhe. ${CONTACT_SENTENCE}`,
    ],
  });
}

export function renderEstimateApprovalConfirmedEmail(
  input: EstimateApprovalConfirmedInput,
): EmailDraft {
  return draft(input, CUSTOMER_TEMPLATE_IDS.estimateApprovalConfirmed, {
    subject: `Bestätigung Ihrer Freigabe: Kostenvoranschlag ${input.estimateNumber}`,
    paragraphs: [
      `vielen Dank für Ihre Freigabe des Kostenvoranschlags ${input.estimateNumber} am ${formatDate(input.approvedAt)}.`,
      `Wir bestätigen Ihre Freigabe hiermit. ${CONTACT_SENTENCE}`,
    ],
  });
}

export function renderOrderReadyEmail(input: OrderReadyInput): EmailDraft {
  return draft(input, CUSTOMER_TEMPLATE_IDS.orderReady, {
    subject: `Ihr Fahrzeug ist fertig: Auftrag ${input.orderNumber}`,
    paragraphs: [
      `die Arbeiten an Ihrem Fahrzeug ${input.vehicleLabel} sind abgeschlossen. Sie können Ihr Fahrzeug bei uns abholen.`,
      CONTACT_SENTENCE,
    ],
  });
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
