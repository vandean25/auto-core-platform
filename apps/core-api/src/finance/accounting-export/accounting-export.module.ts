import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AccountingExportController } from './accounting-export.controller.js';
import { AccountingExportReadinessController } from './accounting-export-readiness.controller.js';
import { AccountingExportReadinessService } from './accounting-export-readiness.service.js';
import { AccountingExportService } from './accounting-export.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [
    AccountingExportController,
    AccountingExportReadinessController,
  ],
  providers: [AccountingExportService, AccountingExportReadinessService],
  exports: [AccountingExportService],
})
export class AccountingExportModule {}
