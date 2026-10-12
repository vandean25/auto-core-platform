import { Injectable } from '@nestjs/common';
import { BrevoEmailProvider } from './brevo-email-provider.js';
import { FakeEmailProvider } from './fake-email-provider.js';
import type { EmailProvider, EmailProviderName } from './email-provider.js';
import { SesEmailProvider } from './ses-email-provider.js';

/** Picks the transport for one send. The only place that knows which concrete provider exists. */
@Injectable()
export class EmailProviderResolver {
  constructor(
    private readonly fake: FakeEmailProvider,
    private readonly brevo: BrevoEmailProvider,
    private readonly ses: SesEmailProvider,
  ) {}

  resolve(name: EmailProviderName): EmailProvider {
    switch (name) {
      case 'fake':
        return this.fake;
      case 'brevo':
        return this.brevo;
      case 'ses':
        return this.ses;
    }
  }
}
