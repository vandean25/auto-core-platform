import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { Throttle } from '@nestjs/throttler';
import { Public } from '../common/decorators/public.decorator.js';
import { CustomerConsentService } from './customer-consent.service.js';
import {
  CONSENT_UNSUBSCRIBE_IP_THROTTLER,
  CONSENT_UNSUBSCRIBE_TOKEN_PATTERN,
} from './public-customer-consent-unsubscribe.constants.js';

@Controller('public/consent-unsubscribe')
export class PublicCustomerConsentUnsubscribeController {
  constructor(private readonly consentService: CustomerConsentService) {}

  @Public()
  @Post(':token')
  @HttpCode(200)
  @Throttle({ [CONSENT_UNSUBSCRIBE_IP_THROTTLER]: { limit: 30, ttl: 60_000 } })
  @ApiOkResponse({
    description: 'Generic success even for unknown or replayed tokens.',
  })
  async unsubscribe(@Param('token') token: string) {
    if (!CONSENT_UNSUBSCRIBE_TOKEN_PATTERN.test(token)) {
      return { ok: true };
    }
    await this.consentService.withdrawMarketingByUnsubscribeToken(token);
    return { ok: true };
  }
}
