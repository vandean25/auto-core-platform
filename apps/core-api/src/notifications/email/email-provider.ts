export type EmailProviderName = 'fake' | 'brevo' | 'ses';

export interface EmailAddress {
  /** One plain address (checked by the outbox writer and again by the worker). */
  email: string;
  /**
   * Display name as plain text, on one line. It may contain commas or quotes, so an adapter must quote
   * it when it writes a header (RFC 5322) or send it in a structured field. Never splice it in raw.
   */
  name: string;
}

/** One rendered message. Built from the outbox row; the worker never renders anything itself. */
export interface OutgoingEmail {
  to: string;
  from: EmailAddress;
  replyTo: EmailAddress | null;
  subject: string;
  text: string;
  /** Provider dashboard tags. Never personal data. */
  tags: string[];
}

export interface EmailSendOptions {
  /** Outbox row id. Lets a provider that supports idempotency dedupe a retried call. */
  idempotencyKey: string;
  signal?: AbortSignal;
}

export interface EmailSendResult {
  providerMessageId: string;
}

/**
 * transient: retry with backoff (network, timeout, 5xx, 429).
 * permanent: stop; the row becomes FAILED (4xx, configuration).
 * recipient_rejected: permanent, and the provider refused the address itself (hard bounce).
 */
export type EmailProviderErrorKind =
  'transient' | 'permanent' | 'recipient_rejected';

export class EmailProviderError extends Error {
  constructor(
    readonly kind: EmailProviderErrorKind,
    /** Short machine code stored on the row. Never a provider response body. */
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = 'EmailProviderError';
  }
}

/** Swappable transport (ADR-0025 §6, AUT-356). Brevo is the planner default; SES eu-central-1 stays viable. */
export interface EmailProvider {
  readonly name: EmailProviderName;
  send(
    message: OutgoingEmail,
    options: EmailSendOptions,
  ): Promise<EmailSendResult>;
}
