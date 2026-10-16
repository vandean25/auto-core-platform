import { Controller, HttpCode, Param, Post } from '@nestjs/common';
import { ApiOkResponse } from '@nestjs/swagger';
import { Public } from '../common/decorators/public.decorator.js';
import { CustomerConsentService } from './customer-consent.service.js';

@Controller('public/consent-unsubscribe')
export class PublicCustomerConsentUnsubscribeController {
  constructor(private readonly consentService: CustomerConsentService) {}

  @Public()
  @Post(':token')
  @HttpCode(200)
  @ApiOkResponse({ description: 'Generic success even for unknown or replayed tokens.' })
  async unsubscribe(@Param('token') token: string) {
    await this.consentService.withdrawMarketingByUnsubscribeToken(token);
    return { ok: true };
  }
}
