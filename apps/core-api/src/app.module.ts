import { Module } from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { InventoryModule } from './inventory/inventory.module';
import { PrismaModule } from './prisma/prisma.module';
import { ApiKeyGuard } from './common/guards/api-key.guard';

import { PurchaseModule } from './purchase/purchase.module';
import { VendorModule } from './vendor/vendor.module';
import { SalesModule } from './sales/sales.module';
import { CustomerModule } from './customer/customer.module';
import { FinanceModule } from './finance/finance.module';
import { BrandModule } from './brand/brand.module';
import { SalesOrderModule } from './sales/sales-order/sales-order.module';

@Module({
  imports: [
    PrismaModule,
    InventoryModule,
    PurchaseModule,
    VendorModule,
    SalesModule,
    CustomerModule,
    FinanceModule,
    BrandModule,
    SalesOrderModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
