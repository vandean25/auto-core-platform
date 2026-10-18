import type { DisplayLanguage } from '../../common/i18n/display-language.js';
import { DEFAULT_DISPLAY_LANGUAGE } from '../../common/i18n/display-language.js';
import { createEmailTranslator } from '../../common/i18n/email-i18n.js';
import type { EmailDraft } from '../notification-outbox.email-columns.js';
import { isSingleLineText } from '../email/header-text.js';
import {
  formatWorkshopEstimateDate,
  formatWorkshopEstimateValidUntil,
} from '../../workshop/workshop-estimate-snapshot.js';

/**
 * Customer messages in the formal Sie form (ADR-0025 section 6, AUT-360 D16: transactional).
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

/** The recipient and sender details every customer message shares. */
export interface CustomerMessageContext {
  recipientEmail: string;
  /** The workshop's display name, used in the sign-off. */
  senderName: string;
  replyToEmail?: string | null;
  /** A salutation such as "Sehr geehrte Frau Muster", without the comma. Defaults to the neutral form. */
  greeting?: string | null;
  /** AUT-588 customer document language for the message body. */
  documentLocale?: DisplayLanguage;
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

function resolveDocumentLocale(
  input: CustomerMessageContext,
): DisplayLanguage {
  return input.documentLocale ?? DEFAULT_DISPLAY_LANGUAGE;
}

export function renderEstimateSentEmail(input: EstimateSentInput): EmailDraft {
  const documentLocale = resolveDocumentLocale(input);
  const t = createEmailTranslator(documentLocale);
  const estimateNumber = requiredText('estimateNumber', input.estimateNumber);
  const vehicleLabel = requiredText('vehicleLabel', input.vehicleLabel);
  const approvalUrl = requiredHttpsUrl('approvalUrl', input.approvalUrl);
  const validUntil = requiredInstant('validUntil', input.validUntil);
  const contactSentence = t('shared.contactSentence');
  const validUntilLabel = formatWorkshopEstimateValidUntil(validUntil);
  return draft(input, CUSTOMER_TEMPLATE_IDS.estimateSent, documentLocale, {
    subject: t('customer.estimateSent.subject', { estimateNumber }),
    paragraphs: [
      t('customer.estimateSent.intro', { vehicleLabel, estimateNumber }),
      t('customer.estimateSent.link', { approvalUrl }),
      t('customer.estimateSent.validity', {
        validUntil: validUntilLabel,
        contactSentence,
      }),
    ],
  });
}

export function renderEstimateApprovalConfirmedEmail(
  input: EstimateApprovalConfirmedInput,
): EmailDraft {
  const documentLocale = resolveDocumentLocale(input);
  const t = createEmailTranslator(documentLocale);
  const estimateNumber = requiredText('estimateNumber', input.estimateNumber);
  const approvedAt = requiredInstant('approvedAt', input.approvedAt);
  const contactSentence = t('shared.contactSentence');
  const approvedAtLabel = formatWorkshopEstimateDate(approvedAt);
  return draft(
    input,
    CUSTOMER_TEMPLATE_IDS.estimateApprovalConfirmed,
    documentLocale,
    {
      subject: t('customer.estimateApprovalConfirmed.subject', {
        estimateNumber,
      }),
      paragraphs: [
        t('customer.estimateApprovalConfirmed.thanks', {
          estimateNumber,
          approvedAt: approvedAtLabel,
        }),
        t('customer.estimateApprovalConfirmed.confirm', { contactSentence }),
      ],
    },
  );
}

export function renderOrderReadyEmail(input: OrderReadyInput): EmailDraft {
  const documentLocale = resolveDocumentLocale(input);
  const t = createEmailTranslator(documentLocale);
  const orderNumber = requiredText('orderNumber', input.orderNumber);
  const vehicleLabel = requiredText('vehicleLabel', input.vehicleLabel);
  const contactSentence = t('shared.contactSentence');
  return draft(input, CUSTOMER_TEMPLATE_IDS.orderReady, documentLocale, {
    subject: t('customer.orderReady.subject', { orderNumber }),
    paragraphs: [
      t('customer.orderReady.body', { vehicleLabel }),
      contactSentence,
      t('customer.orderReady.footer', { orderNumber }),
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
  documentLocale: DisplayLanguage,
  content: { subject: string; paragraphs: string[] },
): EmailDraft {
  const t = createEmailTranslator(documentLocale);
  const senderName = requiredText('senderName', input.senderName);
  const salutation = salutationFor(input.greeting, t('shared.defaultGreeting'));
  return {
    recipientEmail: input.recipientEmail,
    senderName,
    replyToEmail: input.replyToEmail ?? null,
    subject: content.subject,
    text: [
      `${salutation},`,
      ...content.paragraphs,
      `${t('shared.closing')}\n${senderName}`,
    ].join('\n\n'),
    templateId,
    templateVersion: CUSTOMER_TEMPLATE_VERSION,
    documentLocale,
  };
}

/**
 * The salutation without the comma the copy adds. Commas and spaces at either end are dropped, and a
 * greeting that is blank once they are gone gets the neutral form.
 */
function salutationFor(
  greeting: string | null | undefined,
  defaultGreeting: string,
): string {
  if (!greeting || greeting.trim() === '') {
    return defaultGreeting;
  }
  const salutation = requiredText('greeting', greeting).replace(
    /^[,\s]+|[,\s]+$/g,
    '',
  );
  return salutation === '' ? defaultGreeting : salutation;
}
