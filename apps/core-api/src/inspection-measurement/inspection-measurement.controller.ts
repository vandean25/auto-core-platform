import {
  Body,
  Controller,
  Get,
  HttpCode,
  Inject,
  Param,
  ParseIntPipe,
  Post,
  Query,
} from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import { ApiPaginatedResponse } from '../common/dto/paginated-response.dto.js';
import { ApplyMeasurementImportDto } from './dto/apply-measurement-import.dto.js';
import {
  ApplyMeasurementImportResponseDto,
  MeasurementImportListItemDto,
  MeasurementImportPreviewResponseDto,
} from './dto/measurement-import-response.dto.js';
import { PreviewMeasurementImportDto } from './dto/preview-measurement-import.dto.js';
import { InspectionMeasurementService } from './inspection-measurement.service.js';

@ApiTags('workshop-orders')
@Controller('workshop-orders')
export class InspectionMeasurementController {
  constructor(
    @Inject(InspectionMeasurementService)
    private readonly measurementService: InspectionMeasurementService,
  ) {}

  @Get('inspection-device-sources')
  @ApiOperation({ summary: 'List active brake device sources for site' })
  listDeviceSources() {
    return this.measurementService.listActiveDeviceSources();
  }

  @Post(':orderId/measurements/preview')
  @HttpCode(201)
  @ApiOperation({ summary: 'Preview brake measurement import for workshop order' })
  @ApiOkResponse({ type: MeasurementImportPreviewResponseDto })
  preview(
    @Param('orderId') orderId: string,
    @Body() dto: PreviewMeasurementImportDto,
  ) {
    return this.measurementService.previewImport(orderId, dto);
  }

  @Post(':orderId/measurements/:importId/apply')
  @HttpCode(200)
  @ApiOperation({ summary: 'Apply reviewed brake measurement import' })
  @ApiOkResponse({ type: ApplyMeasurementImportResponseDto })
  apply(
    @Param('orderId') orderId: string,
    @Param('importId') importId: string,
    @Body() dto: ApplyMeasurementImportDto,
  ) {
    return this.measurementService.applyImport(orderId, importId, dto);
  }

  @Get(':orderId/measurements')
  @ApiOperation({ summary: 'List brake measurement imports for workshop order' })
  @ApiPaginatedResponse(MeasurementImportListItemDto)
  list(
    @Param('orderId') orderId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.measurementService.listImports(orderId, page, limit);
  }
}
