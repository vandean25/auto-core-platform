import {
  BadRequestException,
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ImportService } from './import.service.js';
import { MIGRATION_MANIFEST_ERROR_CODES } from './migration-manifest.errors.js';
import { parseMigrationManifestJson } from './migration-manifest.validator.js';

@ApiTags('imports')
@Controller('imports')
export class CanonicalMigrationImportController {
  constructor(private readonly importService: ImportService) {}

  @Post('canonical-migration/validate')
  @UseInterceptors(
    FileFieldsInterceptor([
      { name: 'manifest', maxCount: 1 },
      { name: 'files', maxCount: 20 },
    ]),
  )
  @ApiConsumes('multipart/form-data')
  @ApiOperation({
    summary:
      'Validate a canonical migration CSV bundle (manifest.json + CSV files)',
  })
  validateCanonicalMigration(
    @UploadedFiles()
    uploads: {
      manifest?: Express.Multer.File[];
      files?: Express.Multer.File[];
    },
  ) {
    const manifestFile = uploads.manifest?.[0];
    if (!manifestFile?.buffer) {
      throw new BadRequestException({
        code: MIGRATION_MANIFEST_ERROR_CODES.MIGRATION_MANIFEST_SCHEMA_INVALID,
        message: 'manifest file is required',
      });
    }
    const manifest = parseMigrationManifestJson(manifestFile.buffer);
    const files: Record<string, Buffer> = {};
    for (const file of uploads.files ?? []) {
      if (file.originalname) {
        files[file.originalname] = file.buffer;
      }
    }
    return this.importService.validateCanonicalMigrationBundle({
      manifest,
      files,
    });
  }
}
