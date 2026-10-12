import { isRecipientAllowlisted } from './email/recipient-allowlist.js';

export type NotificationEmailMode = 'off' | 'fake' | 'live';
export type LiveEmailProviderName = 'brevo' | 'ses';

export type EmailDeliveryDecision =
  | { action: 'send'; provider: 'fake' | LiveEmailProviderName }
  | {
      action: 'suppress';
      reason: 'EMAIL_DISABLED' | 'RECIPIENT_NOT_ALLOWLISTED';
    };

/**
 * Decides, at send time, whether a due EMAIL row may leave the system. Read on every attempt, so a
 * flag change applies without redeploying queued tasks.
 *  - off: nothing is sent; the row is SUPPRESSED (EMAIL_DISABLED).
 *  - fake: the in-memory provider only; nothing reaches a real mailbox.
 *  - live: a real provider, and only for allowlisted recipients (fail closed).
 */
export function decideEmailDelivery(input: {
  mode: NotificationEmailMode;
  liveProvider: LiveEmailProviderName;
  allowlist: readonly string[];
  recipientEmail: string;
}): EmailDeliveryDecision {
  if (input.mode === 'off') {
    return { action: 'suppress', reason: 'EMAIL_DISABLED' };
  }
  if (input.mode === 'fake') {
    return { action: 'send', provider: 'fake' };
  }
  if (!isRecipientAllowlisted(input.recipientEmail, input.allowlist)) {
    return { action: 'suppress', reason: 'RECIPIENT_NOT_ALLOWLISTED' };
  }
  return { action: 'send', provider: input.liveProvider };
}
