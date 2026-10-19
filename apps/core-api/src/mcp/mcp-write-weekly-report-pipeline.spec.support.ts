import type { Provider } from '@nestjs/common';
import { WorkshopMediaUploadMcpService } from '../mechanic/workshop-media-upload-mcp.service.js';
import { WeeklyReportMcpService } from '../reports/weekly-report/weekly-report-mcp.service.js';
import type { WeeklyReportPdfService } from '../reports/weekly-report/weekly-report-pdf.service.js';

/** Nest test providers for MCP write pipeline media + weekly adapters. */
export function mcpWritePipelineMediaWeeklyTestProviders(
  weeklyReportPdf?: WeeklyReportPdfService,
): Provider[] {
  return [
    {
      provide: WorkshopMediaUploadMcpService,
      useValue: {
        previewUploadSlot: jest.fn(),
        createUploadSlot: jest.fn(),
      },
    },
    {
      provide: WeeklyReportMcpService,
      useValue: weeklyReportPdf
        ? {
            preview: (input: unknown) => weeklyReportPdf.preview(input),
            execute: (input: unknown) => weeklyReportPdf.execute(input),
            refreshReplayResult: jest.fn(),
          }
        : {
            preview: jest.fn(),
            execute: jest.fn(),
            refreshReplayResult: jest.fn(),
          },
    },
  ];
}
