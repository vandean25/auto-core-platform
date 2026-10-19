import { Module, forwardRef } from '@nestjs/common';
import { CommonModule } from '../../common/common.module.js';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { SiteModule } from '../../site/site.module.js';
import { WorkshopModule } from '../../workshop/workshop.module.js';
import { WeeklyReportDataService } from './weekly-report-data.service.js';
import { WeeklyReportMcpService } from './weekly-report-mcp.service.js';
import { WeeklyReportPdfRenderer } from './weekly-report-pdf.renderer.js';
import { WeeklyReportPdfService } from './weekly-report-pdf.service.js';
import { PublicRateLimitStore } from '../../landing-demo-access/public-rate-limit.store.js';
import { WeeklyReportRateLimitService } from './weekly-report-rate-limit.service.js';

@Module({
  imports: [
    PrismaModule,
    CommonModule,
    SiteModule,
    forwardRef(() => WorkshopModule),
  ],
  providers: [
    WeeklyReportDataService,
    WeeklyReportPdfRenderer,
    WeeklyReportPdfService,
    PublicRateLimitStore,
    WeeklyReportRateLimitService,
    WeeklyReportMcpService,
  ],
  exports: [WeeklyReportMcpService, WeeklyReportPdfService],
})
export class WeeklyReportModule {}
