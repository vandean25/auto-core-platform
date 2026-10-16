import { Body, Controller, Get, Param, Post, Query } from '@nestjs/common';
import { ApiCreatedResponse, ApiOkResponse, ApiQuery } from '@nestjs/swagger';
import { CustomerConsentService } from './customer-consent.service.js';
import { assertConsentLedgerAccess } from './customer-consent.controller-context.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  CommunicationEventResponseDto,
  CommunicationHistoryResponseDto,
  CommunicationPreferencesResponseDto,
  RecordCommunicationEventDto,
} from './dto/customer-consent.dto.js';

@Controller('customers')
export class CustomerConsentController {
  constructor(
    private readonly consentService: CustomerConsentService,
    private readonly tenantContext: TenantContextService,
  ) {}

  @Get(':id/communication-preferences')
  @ApiOkResponse({ type: CommunicationPreferencesResponseDto })
  @ApiQuery({ name: 'controller_legal_entity_id', required: false })
  async getPreferences(
    @Param('id') customerId: string,
    @Query('controller_legal_entity_id') controllerLegalEntityId?: string,
  ) {
    assertConsentLedgerAccess(this.tenantContext);
    return this.consentService.getCommunicationPreferences(
      customerId,
      controllerLegalEntityId,
    );
  }

  @Get(':id/communication-history')
  @ApiOkResponse({ type: CommunicationHistoryResponseDto })
  @ApiQuery({ name: 'controller_legal_entity_id', required: false })
  @ApiQuery({ name: 'page', required: false })
  @ApiQuery({ name: 'pageSize', required: false })
  async getHistory(
    @Param('id') customerId: string,
    @Query('controller_legal_entity_id') controllerLegalEntityId?: string,
    @Query('page') page?: string,
    @Query('pageSize') pageSize?: string,
  ) {
    assertConsentLedgerAccess(this.tenantContext);
    const parsedPage = page ? parseInt(page, 10) : 1;
    const parsedSize = pageSize ? parseInt(pageSize, 10) : 25;
    return this.consentService.listCommunicationHistory(
      customerId,
      controllerLegalEntityId,
      Number.isFinite(parsedPage) && parsedPage > 0 ? parsedPage : 1,
      Number.isFinite(parsedSize) && parsedSize > 0 ? parsedSize : 25,
    );
  }

  @Post(':id/communication-events')
  @ApiCreatedResponse({ type: CommunicationEventResponseDto })
  async recordEvent(
    @Param('id') customerId: string,
    @Body() body: RecordCommunicationEventDto,
  ) {
    assertConsentLedgerAccess(this.tenantContext);
    return this.consentService.recordCommunicationEvent(customerId, body);
  }
}
