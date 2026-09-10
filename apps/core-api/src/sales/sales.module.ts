import { Module } from '@nestjs/common';
import { SalesService } from './sales.service';
import { SalesController } from './sales.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';
import { InvoiceFinalizationService } from './invoice-finalization.service';

@Module({
  imports: [InventoryModule, PrismaModule],
  controllers: [SalesController],
  providers: [SalesService, InvoiceFinalizationService],
})
export class SalesModule {}
