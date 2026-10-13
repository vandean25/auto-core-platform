import { Injectable } from '@nestjs/common';
import { randomUUID } from 'node:crypto';
import {
  EmailProviderError,
  type EmailProvider,
  type EmailSendOptions,
  type EmailSendResult,
  type OutgoingEmail,
} from './email-provider.js';

interface RecordedSend {
  message: OutgoingEmail;
  options: EmailSendOptions;
  providerMessageId: string;
}

/** Only the latest sends are kept, so a long-running fake instance cannot grow without bound. */
const MAX_RECORDED_SENDS = 100;

/**
 * In-memory provider for tests and non-production UAT. Never reaches the network. Failures can be
 * scripted per call so the retry and dead-letter paths are testable without a real provider.
 */
@Injectable()
export class FakeEmailProvider implements EmailProvider {
  readonly name = 'fake' as const;
  readonly sent: RecordedSend[] = [];
  private readonly scripted: EmailProviderError[] = [];

  /** The next send fails with this error, then sending succeeds again. */
  failNext(error: EmailProviderError): void {
    this.scripted.push(error);
  }

  reset(): void {
    this.sent.length = 0;
    this.scripted.length = 0;
  }

  send(
    message: OutgoingEmail,
    options: EmailSendOptions,
  ): Promise<EmailSendResult> {
    const failure = this.scripted.shift();
    if (failure) {
      return Promise.reject(failure);
    }
    const providerMessageId = `fake-${randomUUID()}`;
    this.sent.push({ message, options, providerMessageId });
    if (this.sent.length > MAX_RECORDED_SENDS) {
      this.sent.shift();
    }
    return Promise.resolve({ providerMessageId });
  }
}
