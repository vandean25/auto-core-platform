import {
  Body,
  Controller,
  Delete,
  Get,
  Headers,
  HttpCode,
  HttpException,
  HttpStatus,
  Param,
  ParseIntPipe,
  Post,
  Put,
  Query,
  Res,
  StreamableFile,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiConsumes,
  ApiBody,
  ApiAcceptedResponse,
  ApiHeader,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import {
  DocumentBrandPreviewDto,
  DocumentBrandAssetResponseDto,
  CreateDocumentBrandExtractionDto,
  DocumentBrandExtractionResponseDto,
  DocumentBrandPreviewResponseDto,
  DocumentBrandProfileResponseDto,
  ExpectedDocumentBrandRevisionDto,
  SaveDocumentBrandDraftDto,
  SaveDocumentBrandDraftSourceDto,
} from './dto/document-branding.dto.js';
import { DocumentBrandingService } from './document-branding.service.js';
import {
  buildContentDisposition,
  DocumentBrandingUploadService,
} from './document-branding-upload.service.js';
import { DocumentBrandingExtractionService } from './document-branding-extraction.service.js';

const MAX_SOURCE_UPLOAD_BYTES = 10 * 1024 * 1024;

@ApiTags('Document branding')
@ApiParam({ name: 'legalEntityId', format: 'uuid' })
@Controller('legal-entities/:legalEntityId/document-branding')
export class DocumentBrandingController {
  constructor(
    private readonly branding: DocumentBrandingService,
    private readonly uploads: DocumentBrandingUploadService,
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

  @Post('assets')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_SOURCE_UPLOAD_BYTES } }),
  )
  @ApiOperation({ summary: 'Upload a private document branding asset' })
  @ApiConsumes('multipart/form-data')
  @ApiBody({
    schema: {
      type: 'object',
      required: ['purpose', 'file'],
      properties: {
        purpose: { type: 'string', enum: ['SOURCE', 'LOGO'] },
        file: { type: 'string', format: 'binary' },
      },
    },
  })
  @ApiResponse({
    status: 202,
    type: DocumentBrandAssetResponseDto,
    description: 'Quarantined or validated asset metadata',
  })
  async uploadAsset(
    @Param('legalEntityId') legalEntityId: string,
    @Body('purpose') purpose: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return withQuotaRetryAfter(
      () => this.uploads.upload(legalEntityId, purpose, file),
      response,
      'BRAND_UPLOAD_QUOTA_EXCEEDED',
      60 * 60,
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

  @Get('assets/:assetId')
  @ApiOperation({ summary: 'Read document branding asset metadata' })
  @ApiOkResponse({ type: DocumentBrandAssetResponseDto })
  getAsset(
    @Param('legalEntityId') legalEntityId: string,
    @Param('assetId') assetId: string,
  ) {
    return this.uploads.getAsset(legalEntityId, assetId);
  }

  @Get('assets/:assetId/content')
  @ApiOperation({ summary: 'Download a ready document branding asset' })
  @ApiProduces('image/png', 'application/pdf')
  @ApiResponse({ status: 200, schema: { type: 'string', format: 'binary' } })
  async getAssetContent(
    @Param('legalEntityId') legalEntityId: string,
    @Param('assetId') assetId: string,
  ) {
    const content = await this.uploads.getAssetContent(legalEntityId, assetId);
    const disposition = content.purpose === 'SOURCE' ? 'attachment' : 'inline';
    const metadata = await this.uploads.getAsset(legalEntityId, assetId);
    const filename =
      metadata.originalFilename ??
      (content.contentType === 'application/pdf'
        ? 'document-branding-source.pdf'
        : 'document-branding-asset.png');
    return new StreamableFile(content.bytes, {
      type: content.contentType,
      disposition: buildContentDisposition(disposition, filename),
      length: content.bytes.byteLength,
    });
  }

  @Get('assets/:assetId/preview')
  @ApiOperation({
    summary: 'Download the first-page PNG preview of a source asset',
  })
  @ApiProduces('image/png')
  @ApiResponse({ status: 200, schema: { type: 'string', format: 'binary' } })
  async getAssetPagePreview(
    @Param('legalEntityId') legalEntityId: string,
    @Param('assetId') assetId: string,
  ) {
    const preview = await this.uploads.getAssetPagePreview(
      legalEntityId,
      assetId,
    );
    return new StreamableFile(preview.bytes, {
      type: preview.contentType,
      disposition: buildContentDisposition(
        'inline',
        'document-branding-preview.png',
      ),
      length: preview.bytes.byteLength,
    });
  }
}

async function withQuotaRetryAfter<T>(
  action: () => Promise<T>,
  response: Pick<Response, 'setHeader'>,
  quotaCode: string,
  retryAfterSeconds: number,
): Promise<T> {
  try {
    return await action();
  } catch (error) {
    if (error instanceof HttpException && error.getStatus() === 429) {
      const body = error.getResponse();
      if (
        body &&
        typeof body === 'object' &&
        'code' in body &&
        body.code === quotaCode
      ) {
        response.setHeader('Retry-After', String(retryAfterSeconds));
      }
    }
    throw error;
  }
}
