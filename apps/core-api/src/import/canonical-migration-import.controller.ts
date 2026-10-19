import {
  Controller,
  Post,
  UploadedFiles,
  UseInterceptors,
} from '@nestjs/common';
import { FileFieldsInterceptor } from '@nestjs/platform-express';
import { ApiConsumes, ApiOperation, ApiTags } from '@nestjs/swagger';
import { validateCanonicalMigrationUpload } from './canonical-migration-validate.handler.js';
import { ImportService } from './import.service.js';

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
    return validateCanonicalMigrationUpload(this.importService, uploads);
  }
}
