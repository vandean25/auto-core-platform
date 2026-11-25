import { Module } from '@nestjs/common';
import { SalesService } from './sales.service.js';
import { SalesController } from './sales.controller.js';
import { ScopeContextModule } from '../auth/scope-context/scope-context.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { InvoiceListService } from './invoice-list.service.js';
import { InvoiceFinalizationService } from './invoice-finalization.service.js';
import { InvoicesModule } from '../invoices/invoices.module.js';

@Module({
  imports: [ScopeContextModule, InventoryModule, PrismaModule, InvoicesModule],
  controllers: [SalesController],
  providers: [SalesService, InvoiceFinalizationService, InvoiceListService],
})
export class SalesModule {}
