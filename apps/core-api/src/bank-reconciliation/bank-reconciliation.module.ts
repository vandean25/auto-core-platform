import { Module } from '@nestjs/common';
import { BankReconciliationController } from './bank-reconciliation.controller.js';
import { BankReconciliationEnabledGuard } from './bank-reconciliation.guard.js';
import { BankReconciliationService } from './bank-reconciliation.service.js';

@Module({
  controllers: [BankReconciliationController],
  providers: [BankReconciliationService, BankReconciliationEnabledGuard],
  exports: [BankReconciliationService],
})
export class BankReconciliationModule {}
