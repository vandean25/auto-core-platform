import { Injectable } from '@nestjs/common';
import type { CustomerConsentChannel } from '@prisma/client';
import { CustomerConsentService } from './customer-consent.service.js';

export type MarketingUnsubscribeEmailContext = {
  customerId: string;
  controllerLegalEntityId: string;
  channel: CustomerConsentChannel;
  contactFingerprint: string;
};

/**
 * Mints scoped unsubscribe tokens for outbound marketing messages (AUT-374).
 * Transactional outbox rows do not call this until MARKETING message_class exists.
 */
@Injectable()
export class CustomerConsentOutboundUnsubscribeService {
  constructor(private readonly consentService: CustomerConsentService) {}

  async mintTokenForMarketingMessage(
    context: MarketingUnsubscribeEmailContext,
  ): Promise<string> {
    return this.consentService.mintMarketingUnsubscribeToken({
      customerId: context.customerId,
      controllerLegalEntityId: context.controllerLegalEntityId,
      channel: context.channel,
      contactFingerprint: context.contactFingerprint,
    });
  }

  buildUnsubscribePostUrl(publicOrigin: string, rawToken: string): string {
    const base = publicOrigin.replace(/\/$/, '');
    return `${base}/api/public/consent-unsubscribe/${rawToken}`;
  }
}
