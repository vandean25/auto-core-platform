import { Injectable } from '@nestjs/common';
import {
  EmailProviderError,
  type EmailProvider,
  type EmailSendResult,
} from './email-provider.js';

/**
 * Alternative provider kept viable (ADR-0025 §6): Amazon SES in eu-central-1. Stub only, same
 * fail-closed behaviour as the Brevo stub until AUT-362 chooses and wires a provider.
 */
@Injectable()
export class SesEmailProvider implements EmailProvider {
  readonly name = 'ses' as const;

  send(): Promise<EmailSendResult> {
    return Promise.reject(
      new EmailProviderError(
        'permanent',
        'PROVIDER_NOT_CONFIGURED',
        'SES sending is not configured for this environment',
      ),
    );
  }
}
