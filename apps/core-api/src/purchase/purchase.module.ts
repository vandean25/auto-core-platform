import { Module } from '@nestjs/common';
import { PurchaseController } from './purchase.controller.js';
import { PurchaseService } from './purchase.service.js';
import { PurchaseInvoiceService } from './purchase-invoice.service.js';
import { PurchaseInvoiceController } from './purchase-invoice.controller.js';
import { VendorUnbilledController } from './vendor-unbilled.controller.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { DashboardRealtimeModule } from '../dashboard-realtime/dashboard-realtime.module.js';

import { PurchaseInvoiceLifecycleService } from './purchase-invoice-lifecycle.service.js';
import { PurchaseReceiptService } from './purchase-receipt.service.js';

@Module({
  imports: [InventoryModule, PrismaModule, DashboardRealtimeModule],
  controllers: [
    PurchaseController,
    PurchaseInvoiceController,
    VendorUnbilledController,
  ],
  providers: [
    PurchaseService,
    PurchaseReceiptService,
    PurchaseInvoiceService,
    PurchaseInvoiceLifecycleService,
  ],
})
export class PurchaseModule {}
