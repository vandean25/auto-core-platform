import { Injectable } from '@nestjs/common';
import {
  EmailProviderError,
  type EmailProvider,
  type EmailSendResult,
} from './email-provider.js';

/**
 * Planner default provider (ADR-0025 §6). Stub only: the HTTP adapter is wired after AUT-362
 * (DPA, sender domain, API key in GSM). Until then every call fails permanently, so nothing can
 * leave the system through this adapter even with NOTIFICATION_EMAIL_MODE=live.
 */
@Injectable()
export class BrevoEmailProvider implements EmailProvider {
  readonly name = 'brevo' as const;

  send(): Promise<EmailSendResult> {
    return Promise.reject(
      new EmailProviderError(
        'permanent',
        'PROVIDER_NOT_CONFIGURED',
        'Brevo sending is not configured for this environment',
      ),
    );
  }
}
