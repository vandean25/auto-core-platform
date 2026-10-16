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
import {
  ApplyInspectionImportResponseDto,
  ExternalInspectionResultSummaryDto,
  InspectionImportPreviewResponseDto,
} from './dto/inspection-import-response.dto.js';
import { InspectionExchangeService } from './inspection-exchange.service.js';
import { PreviewInspectionImportDto } from './dto/preview-inspection-import.dto.js';
import { ApplyInspectionImportDto } from './dto/apply-inspection-import.dto.js';

@ApiTags('vehicles')
@Controller()
export class InspectionExchangeController {
  constructor(
    @Inject(InspectionExchangeService)
    private readonly inspectionExchange: InspectionExchangeService,
  ) {}

  @Get('inspection-source-connections')
  @ApiOperation({
    summary: 'List active inspection source connections for site',
  })
  listConnections() {
    return this.inspectionExchange.listActiveConnections();
  }

  @Post('vehicles/:vehicleId/inspection-imports/preview')
  @HttpCode(201)
  @ApiOperation({ summary: 'Preview external §57a inspection result import' })
  @ApiOkResponse({ type: InspectionImportPreviewResponseDto })
  preview(
    @Param('vehicleId') vehicleId: string,
    @Body() dto: PreviewInspectionImportDto,
  ) {
    return this.inspectionExchange.previewImport(vehicleId, dto);
  }

  @Post('vehicles/:vehicleId/inspection-imports/:importId/apply')
  @HttpCode(200)
  @ApiOperation({ summary: 'Apply reviewed external inspection import' })
  @ApiOkResponse({ type: ApplyInspectionImportResponseDto })
  apply(
    @Param('vehicleId') vehicleId: string,
    @Param('importId') importId: string,
    @Body() dto: ApplyInspectionImportDto,
  ) {
    return this.inspectionExchange.applyImport(vehicleId, importId, dto);
  }

  @Get('vehicles/:vehicleId/inspection-imports')
  @ApiOperation({ summary: 'List inspection import attempts for vehicle' })
  list(
    @Param('vehicleId') vehicleId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.inspectionExchange.listImports(vehicleId, page, limit);
  }

  @Get('vehicles/:vehicleId/external-inspection-results/:resultId')
  @ApiOperation({
    summary: 'Get external inspection result provenance summary',
  })
  @ApiOkResponse({ type: ExternalInspectionResultSummaryDto })
  getResult(
    @Param('vehicleId') vehicleId: string,
    @Param('resultId') resultId: string,
  ) {
    return this.inspectionExchange.getExternalResult(vehicleId, resultId);
  }
}
