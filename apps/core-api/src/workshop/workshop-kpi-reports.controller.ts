import { Controller, Get, Query } from '@nestjs/common';
import { ApiOkResponse, ApiOperation, ApiTags } from '@nestjs/swagger';
import {
  WorkshopKpiReportQueryDto,
  WorkshopKpiReportResponseDto,
} from './dto/workshop-kpi-reports.dto.js';
import { WorkshopKpiReportsService } from './workshop-kpi-reports.service.js';

@ApiTags('Workshop reports')
@Controller('reports')
export class WorkshopKpiReportsController {
  constructor(private readonly reports: WorkshopKpiReportsService) {}

  @Get('workshop-kpis')
  @ApiOperation({ summary: 'Read workshop KPIs for a site and date range' })
  @ApiOkResponse({ type: WorkshopKpiReportResponseDto })
  getWorkshopKpis(
    @Query() query: WorkshopKpiReportQueryDto,
  ): Promise<WorkshopKpiReportResponseDto> {
    return this.reports.getReport(query);
  }
}
