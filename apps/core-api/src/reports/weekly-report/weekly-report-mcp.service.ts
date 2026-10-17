import { Injectable } from '@nestjs/common';
import type { GenerateWeeklyReportPdfInput } from './weekly-report-pdf.service.js';
import { WeeklyReportPdfService } from './weekly-report-pdf.service.js';

@Injectable()
export class WeeklyReportMcpService {
  constructor(private readonly weeklyReportPdf: WeeklyReportPdfService) {}

  generate(input: GenerateWeeklyReportPdfInput) {
    return this.weeklyReportPdf.generate(input);
  }
}
