import {
  Controller,
  Get,
  Header,
  Param,
  ParseUUIDPipe,
  Query,
  Res,
  StreamableFile,
} from '@nestjs/common';
import type { Response } from 'express';
import {
  ApiOkResponse,
  ApiOperation,
  ApiProduces,
  ApiQuery,
  ApiTags,
} from '@nestjs/swagger';
import { VehicleListingExportService } from './vehicle-listing-export.service.js';
import { VehicleListingExportValidationResponseDto } from './dto/vehicle-listing-export-validation.dto.js';

@ApiTags('vehicle-stock')
@Controller('vehicle-stock/:vehicleId/listing/export')
export class VehicleListingExportController {
  constructor(private readonly listingExports: VehicleListingExportService) {}

  @Get('validate')
  @ApiOperation({
    summary:
      'Validate listing export readiness and serializer rules per portal channel',
  })
  @ApiOkResponse({ type: VehicleListingExportValidationResponseDto })
  validate(@Param('vehicleId', ParseUUIDPipe) vehicleId: string) {
    return this.listingExports.validateListingExport(vehicleId);
  }

  @Get('download')
  @ApiOperation({
    summary:
      'Download a reference listing export package (CSV + images ZIP) for the active stock cycle',
  })
  @ApiQuery({
    name: 'profile',
    required: true,
    description:
      'Listing serializer profile code (e.g. MOBILE_DE_REFERENCE_V1)',
  })
  @ApiProduces('application/zip')
  @Header('Cache-Control', 'no-store')
  async download(
    @Param('vehicleId', ParseUUIDPipe) vehicleId: string,
    @Query('profile') profile: string,
    @Res({ passthrough: true }) res: Response,
  ) {
    const file = await this.listingExports.downloadListingPackage(
      vehicleId,
      profile,
    );
    const safeFilename = file.filename.replace(/["\r\n]+/g, '_');

    res.setHeader('X-Checksum-SHA256', file.sha256);
    res.setHeader('Digest', `SHA-256=${file.sha256}`);

    return new StreamableFile(file.bytes, {
      type: 'application/zip',
      disposition: `attachment; filename="${safeFilename}"`,
      length: file.byteLength,
    });
  }
}
