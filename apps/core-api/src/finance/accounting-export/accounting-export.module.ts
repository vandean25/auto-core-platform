import { Module } from '@nestjs/common';
import { PrismaModule } from '../../prisma/prisma.module.js';
import { AccountingExportController } from './accounting-export.controller.js';
import { AccountingExportService } from './accounting-export.service.js';

@Module({
  imports: [PrismaModule],
  controllers: [AccountingExportController],
  providers: [AccountingExportService],
  exports: [AccountingExportService],
})
export class AccountingExportModule {}
