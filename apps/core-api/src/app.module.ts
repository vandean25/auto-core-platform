import { Module } from '@nestjs/common';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InventoryModule } from './inventory/inventory.module';
import { PrismaModule } from './prisma/prisma.module';

import { PurchaseModule } from './purchase/purchase.module';
import { VendorModule } from './vendor/vendor.module';
import { SalesModule } from './sales/sales.module';
import { CustomerModule } from './customer/customer.module';
import { FinanceModule } from './finance/finance.module';

@Module({
  imports: [PrismaModule, InventoryModule, PurchaseModule, VendorModule, SalesModule, CustomerModule, FinanceModule],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule {}
