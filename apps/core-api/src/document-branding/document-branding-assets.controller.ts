import {
  Body,
  Controller,
  Get,
  HttpCode,
  HttpStatus,
  Param,
  Post,
  Res,
  UploadedFile,
  UseInterceptors,
} from '@nestjs/common';
import type { Response } from 'express';
import { FileInterceptor } from '@nestjs/platform-express';
import {
  ApiConsumes,
  ApiBody,
  ApiOperation,
  ApiOkResponse,
  ApiParam,
  ApiProduces,
  ApiResponse,
  ApiTags,
} from '@nestjs/swagger';
import { DocumentBrandAssetResponseDto } from './dto/document-branding.dto.js';
import { DocumentBrandingUploadService } from './document-branding-upload.service.js';
import {
  getBrandingAssetMetadata,
  streamBrandingAssetContent,
  streamBrandingAssetPagePreview,
  uploadBrandingAsset,
} from './document-branding-asset-http.handler.js';

const MAX_SOURCE_UPLOAD_BYTES = 10 * 1024 * 1024;

@ApiTags('Document branding')
@ApiParam({ name: 'legalEntityId', format: 'uuid' })
@Controller('legal-entities/:legalEntityId/document-branding')
export class DocumentBrandingAssetsController {
  constructor(private readonly uploads: DocumentBrandingUploadService) {}

  @Post('assets')
  @HttpCode(HttpStatus.ACCEPTED)
  @UseInterceptors(
    FileInterceptor('file', { limits: { fileSize: MAX_SOURCE_UPLOAD_BYTES } }),
  )
  @ApiOperation({
    operationId: 'DocumentBrandingController_uploadAsset',
    summary: 'Upload a private document branding asset',
  })
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
  uploadAsset(
    @Param('legalEntityId') legalEntityId: string,
    @Body('purpose') purpose: string,
    @UploadedFile() file: Express.Multer.File | undefined,
    @Res({ passthrough: true }) response: Response,
  ) {
    return uploadBrandingAsset(
      this.uploads,
      legalEntityId,
      purpose,
      file,
      response,
    );
  }

  @Get('assets/:assetId')
  @ApiOperation({
    operationId: 'DocumentBrandingController_getAsset',
    summary: 'Read document branding asset metadata',
  })
  @ApiOkResponse({ type: DocumentBrandAssetResponseDto })
  getAsset(
    @Param('legalEntityId') legalEntityId: string,
    @Param('assetId') assetId: string,
  ) {
    return getBrandingAssetMetadata(this.uploads, legalEntityId, assetId);
  }

  @Get('assets/:assetId/content')
  @ApiOperation({
    operationId: 'DocumentBrandingController_getAssetContent',
    summary: 'Download a ready document branding asset',
  })
  @ApiProduces('image/png', 'application/pdf')
  @ApiResponse({ status: 200, schema: { type: 'string', format: 'binary' } })
  getAssetContent(
    @Param('legalEntityId') legalEntityId: string,
    @Param('assetId') assetId: string,
  ) {
    return streamBrandingAssetContent(this.uploads, legalEntityId, assetId);
  }

  @Get('assets/:assetId/preview')
  @ApiOperation({
    operationId: 'DocumentBrandingController_getAssetPagePreview',
    summary: 'Download the first-page PNG preview of a source asset',
  })
  @ApiProduces('image/png')
  @ApiResponse({ status: 200, schema: { type: 'string', format: 'binary' } })
  getAssetPagePreview(
    @Param('legalEntityId') legalEntityId: string,
    @Param('assetId') assetId: string,
  ) {
    return streamBrandingAssetPagePreview(this.uploads, legalEntityId, assetId);
  }
}
