import { Module } from '@nestjs/common';
import { PurchaseController } from './purchase.controller';
import { PurchaseService } from './purchase.service';
import { PurchaseInvoiceService } from './purchase-invoice.service';
import { PurchaseInvoiceController } from './purchase-invoice.controller';
import { VendorUnbilledController } from './vendor-unbilled.controller';
import { PrismaModule } from '../prisma/prisma.module';
import { InventoryModule } from '../inventory/inventory.module';

@Module({
  imports: [InventoryModule, PrismaModule],
  controllers: [PurchaseController, PurchaseInvoiceController, VendorUnbilledController],
  providers: [PurchaseService, PurchaseInvoiceService],
})
export class PurchaseModule {}
