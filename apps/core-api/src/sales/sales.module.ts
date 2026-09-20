import { Module } from '@nestjs/common';
import { SalesService } from './sales.service.js';
import { SalesController } from './sales.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { InvoiceFinalizationService } from './invoice-finalization.service.js';
import { InvoicesModule } from '../invoices/invoices.module.js';

@Module({
  imports: [InventoryModule, PrismaModule, InvoicesModule],
  controllers: [SalesController],
  providers: [SalesService, InvoiceFinalizationService],
})
export class SalesModule {}
