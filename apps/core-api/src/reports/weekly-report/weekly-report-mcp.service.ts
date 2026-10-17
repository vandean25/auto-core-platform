import { Injectable } from '@nestjs/common';
import type { McpWriteToolResult } from '../../mcp/mcp-write-pipeline.service.js';
import type {
  GenerateWeeklyReportPdfInput,
  GenerateWeeklyReportPdfResult,
} from './weekly-report-pdf.service.js';
import { WeeklyReportPdfService } from './weekly-report-pdf.service.js';

@Injectable()
export class WeeklyReportMcpService {
  constructor(private readonly weeklyReportPdf: WeeklyReportPdfService) {}

  preview(input: GenerateWeeklyReportPdfInput) {
    return this.weeklyReportPdf.preview(input);
  }

  execute(input: GenerateWeeklyReportPdfInput) {
    return this.weeklyReportPdf.execute(input);
  }

  async refreshReplayResult(
    result: McpWriteToolResult,
  ): Promise<McpWriteToolResult> {
    if (!result.result || result.tool !== 'generate_weekly_report_pdf') {
      return result;
    }
    const stored = result.result as GenerateWeeklyReportPdfResult;
    const refreshed = await this.weeklyReportPdf.refreshSignedUrl(stored);
    return {
      ...result,
      result: refreshed,
    };
  }
}
