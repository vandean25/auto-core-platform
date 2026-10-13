import { createHash } from 'node:crypto';
import { isPlainEmailAddress } from './email/email-address.js';
import { isSingleLineText } from './email/header-text.js';

/**
 * A message rendered before it enters the outbox. The sender worker sends `text` as it is and never
 * renders anything itself. The customer templates in `templates/` fill this shape.
 */
export interface EmailDraft {
  recipientEmail: string;
  subject: string;
  text: string;
  senderName: string;
  replyToEmail?: string | null;
  templateId?: string | null;
  templateVersion?: number | null;
}

/** The columns only EMAIL rows carry. Every column is null for an IN_APP row. */
export function buildEmailColumns(email: EmailDraft | undefined) {
  if (email) {
    assertEmailDraft(email);
  }
  return {
    recipient_email: email?.recipientEmail ?? null,
    template_id: email?.templateId ?? null,
    template_version: email?.templateVersion ?? null,
    subject: email?.subject ?? null,
    body: email?.text ?? null,
    body_sha256: email ? sha256Hex(email.text) : null,
    sender_name: email?.senderName ?? null,
    reply_to_email: email?.replyToEmail ?? null,
  };
}

/**
 * A draft must name one recipient, carry a sender, a subject and a text, and cannot break a header or
 * hold a character Postgres TEXT refuses. A bad draft is a programming error: it throws here, inside the
 * caller's transaction, rather than storing a row the worker would fail later without anyone noticing.
 */
function assertEmailDraft(email: EmailDraft): void {
  if (!isPlainEmailAddress(email.recipientEmail)) {
    throw new Error('EMAIL recipient must be one plain address');
  }
  if (email.replyToEmail && !isPlainEmailAddress(email.replyToEmail)) {
    throw new Error('EMAIL reply-to must be one plain address');
  }
  if (
    email.senderName.trim() === '' ||
    email.subject.trim() === '' ||
    email.text.trim() === ''
  ) {
    throw new Error('EMAIL sender name, subject and text must not be empty');
  }
  if (!isSingleLineText(email.subject) || !isSingleLineText(email.senderName)) {
    throw new Error('EMAIL subject and sender name must be single-line');
  }
  if (email.text.includes('\u0000')) {
    throw new Error('EMAIL text must not contain NUL characters');
  }
}

function sha256Hex(text: string): string {
  return createHash('sha256').update(text, 'utf8').digest('hex');
}
