import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import {
  ApiBody,
  ApiConsumes,
  ApiCreatedResponse,
  ApiOperation,
  ApiTags,
} from '@nestjs/swagger';
import { IMPORT_MAX_FILE_BYTES } from '../import.constants.js';
import { CanonicalMigrationValidateResponseDto } from '../dto/canonical-migration-validate-response.dto.js';
import { CanonicalMigrationBundleService } from './canonical-migration-bundle.service.js';
import { validateCanonicalMigrationUpload } from './canonical-migration-validate.handler.js';

const CANONICAL_MIGRATION_UPLOAD_LIMIT_BYTES =
  IMPORT_MAX_FILE_BYTES + 5 * 1024 * 1024;

@ApiTags('imports')
@Controller('imports')
export class CanonicalMigrationImportController {
  constructor(
    private readonly bundleService: CanonicalMigrationBundleService,
  ) {}

  @Post('canonical-migration/validate')
  @UseInterceptors(
    FileFieldsInterceptor(
      [
        { name: 'manifest', maxCount: 1 },
        { name: 'files', maxCount: 20 },
        { name: 'assets', maxCount: 20 },
      ],
      {
        limits: { fileSize: CANONICAL_MIGRATION_UPLOAD_LIMIT_BYTES },
      },
    ),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Validate a canonical migration CSV bundle (manifest.json + CSV files + optional PDF assets)',
  })
  @ApiBody({
    schema: {
      type: 'object',
      required: ['manifest'],
      properties: {
        manifest: {
          type: 'string',
          format: 'binary',
          description: 'manifest.json',
        },
        files: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'CSV files listed in manifest.files',
        },
        assets: {
          type: 'array',
          items: { type: 'string', format: 'binary' },
          description: 'PDF assets listed in manifest.assets',
        },
      },
    },
  })
  @ApiCreatedResponse({ type: CanonicalMigrationValidateResponseDto })
  validateCanonicalMigration(
    @UploadedFiles()
    uploads: {
      manifest?: Express.Multer.File[];
      files?: Express.Multer.File[];
      assets?: Express.Multer.File[];
    },
  ) {
    return validateCanonicalMigrationUpload(this.bundleService, uploads);
  }
}
