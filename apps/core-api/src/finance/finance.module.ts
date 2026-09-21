import { Module, Global } from '@nestjs/common';
import { FinanceService } from './finance.service.js';
import { FinanceController } from './finance.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { AccountingExportModule } from './accounting-export/accounting-export.module.js';

@Global()
@Module({
  imports: [PrismaModule, AccountingExportModule],
  controllers: [FinanceController],
  providers: [FinanceService],
  exports: [FinanceService, AccountingExportModule],
})
export class FinanceModule {}
