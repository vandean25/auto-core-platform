import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiBody,
  ApiAcceptedResponse,
  ApiHeader,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
  ApiTags,
} from '@nestjs/swagger';
import {
  DocumentBrandPreviewDto,
  CreateDocumentBrandExtractionDto,
  DocumentBrandExtractionResponseDto,
  DocumentBrandPreviewResponseDto,
  DocumentBrandProfileResponseDto,
  ExpectedDocumentBrandRevisionDto,
  SaveDocumentBrandDraftDto,
  SaveDocumentBrandDraftSourceDto,
} from './dto/document-branding.dto.js';
import { DocumentBrandingService } from './document-branding.service.js';
import { DocumentBrandingExtractionService } from './document-branding-extraction.service.js';
import { withQuotaRetryAfter } from './document-branding-quota-http.js';

@ApiTags('Document branding')
@ApiParam({ name: 'legalEntityId', format: 'uuid' })
@Controller('legal-entities/:legalEntityId/document-branding')
export class DocumentBrandingController {
  constructor(
    private readonly branding: DocumentBrandingService,
    private readonly extractions: DocumentBrandingExtractionService,
  ) {}

  @Get()
  @ApiOperation({ summary: 'Read the document branding profile' })
  @ApiOkResponse({
    type: DocumentBrandProfileResponseDto,
    description: 'Profile and resolved active defaults',
  })
  getProfile(@Param('legalEntityId') legalEntityId: string) {
    return this.branding.getProfile(legalEntityId);
  }

  @Put('draft')
  @ApiOperation({ summary: 'Save a complete manual document branding draft' })
  @ApiBody({ type: SaveDocumentBrandDraftDto })
  @ApiOkResponse({ type: DocumentBrandProfileResponseDto })
  saveDraft(
    @Param('legalEntityId') legalEntityId: string,
    @Body() dto: SaveDocumentBrandDraftDto,
  ) {
    return this.branding.saveDraft(legalEntityId, dto);
  }

  @Put('draft/source')
  @ApiOperation({ summary: 'Attach a letterhead source asset to the draft' })
  @ApiBody({ type: SaveDocumentBrandDraftSourceDto })
  @ApiOkResponse({ type: DocumentBrandProfileResponseDto })
  setDraftSource(
    @Param('legalEntityId') legalEntityId: string,
    @Body() dto: SaveDocumentBrandDraftSourceDto,
  ) {
    return this.branding.setDraftSource(legalEntityId, dto);
  }

  @Delete('draft/source')
  @ApiOperation({ summary: 'Remove the draft letterhead source asset' })
  @ApiOkResponse({ type: DocumentBrandProfileResponseDto })
  removeDraftSource(
    @Param('legalEntityId') legalEntityId: string,
    @Query('expectedRevision', ParseIntPipe) expectedRevision: number,
  ) {
    return this.branding.removeDraftSource(legalEntityId, expectedRevision);
  }

  @Delete('draft')
  @ApiOperation({ summary: 'Discard a document branding draft' })
  @ApiOkResponse({ type: DocumentBrandProfileResponseDto })
  discardDraft(
    @Param('legalEntityId') legalEntityId: string,
    @Query('expectedRevision', ParseIntPipe) expectedRevision: number,
  ) {
    return this.branding.discardDraft(legalEntityId, expectedRevision);
  }

  @Post('confirm')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm the current document branding draft' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: DocumentBrandProfileResponseDto })
  confirm(
    @Param('legalEntityId') legalEntityId: string,
    @Body() dto: ExpectedDocumentBrandRevisionDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.branding.confirm(
      legalEntityId,
      dto.expectedRevision,
      idempotencyKey,
    );
  }

  @Post('reset')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Confirm ACP default document branding' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiOkResponse({ type: DocumentBrandProfileResponseDto })
  reset(
    @Param('legalEntityId') legalEntityId: string,
    @Body() dto: ExpectedDocumentBrandRevisionDto,
    @Headers('idempotency-key') idempotencyKey: string,
  ) {
    return this.branding.reset(
      legalEntityId,
      dto.expectedRevision,
      idempotencyKey,
    );
  }

  @Post('preview')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Render a synthetic document branding preview' })
  @ApiBody({ type: DocumentBrandPreviewDto })
  @ApiOkResponse({ type: DocumentBrandPreviewResponseDto })
  preview(
    @Param('legalEntityId') legalEntityId: string,
    @Body() dto: DocumentBrandPreviewDto,
    @Res({ passthrough: true }) response: Response,
  ) {
    return withQuotaRetryAfter(
      () => this.branding.preview(legalEntityId, dto.theme, dto.sample),
      response,
      'BRAND_PREVIEW_QUOTA_EXCEEDED',
      60,
    );
  }

  @Post('extractions')
  @HttpCode(HttpStatus.ACCEPTED)
  @ApiOperation({ summary: 'Start document letterhead extraction' })
  @ApiHeader({ name: 'Idempotency-Key', required: true })
  @ApiBody({ type: CreateDocumentBrandExtractionDto })
  @ApiAcceptedResponse({ type: DocumentBrandExtractionResponseDto })
  createExtraction(
    @Param('legalEntityId') legalEntityId: string,
    @Body() dto: CreateDocumentBrandExtractionDto,
    @Headers('idempotency-key') idempotencyKey: string,
    @Res({ passthrough: true }) response: Response,
  ) {
    return withQuotaRetryAfter(
      () => this.extractions.create(legalEntityId, dto, idempotencyKey),
      response,
      'BRAND_EXTRACTION_QUOTA_EXCEEDED',
      60 * 60,
    );
  }

  @Get('extractions/:extractionId')
  @ApiOperation({ summary: 'Read a letterhead extraction proposal' })
  @ApiOkResponse({ type: DocumentBrandExtractionResponseDto })
  getExtraction(
    @Param('legalEntityId') legalEntityId: string,
    @Param('extractionId') extractionId: string,
  ) {
    return this.extractions.get(legalEntityId, extractionId);
  }

  @Post('extractions/:extractionId/discard')
  @HttpCode(HttpStatus.OK)
  @ApiOperation({ summary: 'Discard a letterhead extraction' })
  @ApiOkResponse({ type: DocumentBrandExtractionResponseDto })
  discardExtraction(
    @Param('legalEntityId') legalEntityId: string,
    @Param('extractionId') extractionId: string,
  ) {
    return this.extractions.discard(legalEntityId, extractionId);
  }
}
