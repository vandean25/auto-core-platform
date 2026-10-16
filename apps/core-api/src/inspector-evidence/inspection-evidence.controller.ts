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
import { CreateInspectorEvidenceDto } from './dto/create-inspector-evidence.dto.js';
import { ReviewInspectorEvidenceDto } from './dto/review-inspector-evidence.dto.js';
import {
  InspectorEvidenceAssessmentResponseDto,
  InspectorEvidenceListResponseDto,
  InspectorEvidenceRevisionResponseDto,
} from './dto/inspector-evidence-response.dto.js';
import { InspectorEvidenceService } from './inspection-evidence.service.js';

@ApiTags('employees')
@Controller('employees/:employeeId/inspection-evidence')
export class InspectorEvidenceController {
  constructor(
    @Inject(InspectorEvidenceService)
    private readonly inspectorEvidence: InspectorEvidenceService,
  ) {}

  @Get()
  @ApiOperation({
    summary: 'List inspector evidence revisions (management only)',
  })
  @ApiOkResponse({ type: InspectorEvidenceListResponseDto })
  list(
    @Param('employeeId') employeeId: string,
    @Query('page', new ParseIntPipe({ optional: true })) page = 1,
    @Query('limit', new ParseIntPipe({ optional: true })) limit = 20,
  ) {
    return this.inspectorEvidence.listRevisions(employeeId, page, limit);
  }

  @Get('assessment')
  @ApiOperation({
    summary: 'Assess inspector evidence support state for station/scope/time',
  })
  @ApiOkResponse({ type: InspectorEvidenceAssessmentResponseDto })
  assess(
    @Param('employeeId') employeeId: string,
    @Query('station_ref') stationRef: string,
    @Query('vehicle_class') vehicleClass?: string,
    @Query('inspection_time') inspectionTime?: string,
    @Query('as_of') asOf?: string,
  ) {
    return this.inspectorEvidence.assess(employeeId, {
      station_ref: stationRef,
      vehicle_class: vehicleClass ?? null,
      inspection_time: inspectionTime,
      as_of: asOf,
    });
  }

  @Post()
  @HttpCode(201)
  @ApiOperation({ summary: 'Append UNREVIEWED inspector evidence revision' })
  @ApiOkResponse({ type: InspectorEvidenceRevisionResponseDto })
  create(
    @Param('employeeId') employeeId: string,
    @Body() dto: CreateInspectorEvidenceDto,
  ) {
    return this.inspectorEvidence.createRevision(employeeId, dto);
  }

  @Post(':revisionId/review')
  @HttpCode(200)
  @ApiOperation({ summary: 'Human review of inspector evidence document' })
  @ApiOkResponse({ type: InspectorEvidenceRevisionResponseDto })
  review(
    @Param('employeeId') employeeId: string,
    @Param('revisionId') revisionId: string,
    @Body() dto: ReviewInspectorEvidenceDto,
  ) {
    return this.inspectorEvidence.reviewRevision(employeeId, revisionId, dto);
  }
}
