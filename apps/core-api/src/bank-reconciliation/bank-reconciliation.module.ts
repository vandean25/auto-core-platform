import { Module } from '@nestjs/common';
import { BankAllocationService } from './bank-allocation.service.js';
import { BankSuggestionsService } from './bank-suggestions.service.js';
import { BankReconciliationController } from './bank-reconciliation.controller.js';
import { BankReconciliationEnabledGuard } from './bank-reconciliation.guard.js';
import { BankReconciliationService } from './bank-reconciliation.service.js';

@Module({
  controllers: [BankReconciliationController],
  providers: [
    BankAllocationService,
    BankReconciliationService,
    BankReconciliationEnabledGuard,
    BankSuggestionsService,
  ],
  exports: [BankReconciliationService],
})
export class BankReconciliationModule {}
