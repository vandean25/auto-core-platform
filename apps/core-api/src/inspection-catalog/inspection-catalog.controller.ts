import {
  BadRequestException,
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
import { ActivateInspectionCatalogueDto } from './dto/activate-inspection-catalogue.dto.js';
import { PreviewInspectionCatalogueDto } from './dto/preview-inspection-catalogue.dto.js';
import {
  ActivateInspectionCatalogueResponseDto,
  CatalogueReferenceListResponseDto,
  CreateInspectionFindingReferenceDto,
  InspectionCataloguePreviewResponseDto,
  InspectionFindingReferenceListItemDto,
  InspectionFindingReferenceResponseDto,
} from './dto/inspection-catalogue-response.dto.js';
import { InspectionCatalogService } from './inspection-catalog.service.js';

@ApiTags('workshop')
@Controller()
export class InspectionCatalogController {
  constructor(
    @Inject(InspectionCatalogService)
    private readonly inspectionCatalog: InspectionCatalogService,
  ) {}

  @Post('inspection-catalogues/preview')
  @HttpCode(201)
  @ApiOperation({
    summary: 'Stage inspection catalogue manifest for activation',
  })
  @ApiOkResponse({ type: InspectionCataloguePreviewResponseDto })
  preview(@Body() dto: PreviewInspectionCatalogueDto) {
    return this.inspectionCatalog.previewCatalogue(dto);
  }

  @Post('inspection-catalogues/:importId/activate')
  @HttpCode(200)
  @ApiOperation({ summary: 'Activate staged inspection catalogue version' })
  @ApiOkResponse({ type: ActivateInspectionCatalogueResponseDto })
  activate(
    @Param('importId') importId: string,
    @Body() dto: ActivateInspectionCatalogueDto,
  ) {
    return this.inspectionCatalog.activateCatalogue(importId, dto);
  }

  @Get('inspection-catalogues/references')
  @ApiOperation({ summary: 'Resolve official catalogue reference codes' })
  @ApiOkResponse({ type: CatalogueReferenceListResponseDto })
  resolveReferences(
    @Query('position_id') positionId?: string,
    @Query('entry_id') entryId?: string,
    @Query('codes') codesJson?: string,
    @Query('inspection_time') inspectionTime?: string,
    @Query('vehicle_class') vehicleClass?: string,
    @Query('catalogue_version_id') catalogueVersionId?: string,
    @Query('for_current_use') forCurrentUse?: string,
  ) {
    const codes = this.parseReferenceCodes(positionId, entryId, codesJson);
    return this.inspectionCatalog.resolveReferences(codes, {
      inspection_time: inspectionTime,
      vehicle_class: vehicleClass ?? null,
      catalogue_version_id: catalogueVersionId ?? null,
      for_current_use: forCurrentUse !== 'false',
    });
  }

  @Post('inspection-catalogues/finding-references')
  @HttpCode(201)
  @ApiOperation({
    summary:
      'Attach immutable official catalogue reference snapshot to checklist',
  })
  @ApiOkResponse({ type: InspectionFindingReferenceResponseDto })
  createFindingReference(@Body() dto: CreateInspectionFindingReferenceDto) {
    return this.inspectionCatalog.createFindingReference(dto);
  }

  @Get('workshop-inspections/:inspectionId/catalogue-references')
  @ApiOperation({ summary: 'List catalogue reference snapshots on inspection' })
  @ApiPaginatedResponse(InspectionFindingReferenceListItemDto)
  listFindingReferences(
    @Param('inspectionId') inspectionId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.inspectionCatalog.listFindingReferences(
      inspectionId,
      page,
      limit,
    );
  }

  private parseReferenceCodes(
    positionId?: string,
    entryId?: string,
    codesJson?: string,
  ): Array<{ position_id: string; entry_id?: string | null }> {
    if (codesJson) {
      let parsed: unknown;
      try {
        parsed = JSON.parse(codesJson);
      } catch {
        throw new BadRequestException({ code: 'INVALID_CODES_JSON' });
      }
      if (!Array.isArray(parsed)) {
        throw new BadRequestException({ code: 'INVALID_CODES_JSON' });
      }
      return (
        parsed as Array<{
          position_id: string;
          entry_id?: string | null;
        }>
      ).slice(0, 50);
    }
    if (positionId) {
      return [{ position_id: positionId, entry_id: entryId ?? null }];
    }
    return [];
  }
}
