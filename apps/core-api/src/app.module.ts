import { Module } from '@nestjs/common';
import { APP_FILTER, APP_GUARD } from '@nestjs/core';
import { SentryModule, SentryGlobalFilter } from '@sentry/nestjs/setup';
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
import { WorkshopModule } from './workshop/workshop.module';
import { InvoicesModule } from './invoices/invoices.module';
import { LaborModule } from './labor/labor.module';
import { CatalogModule } from './catalog/catalog.module';
import { VehicleModule } from './vehicle/vehicle.module';
import { DashboardRealtimeModule } from './dashboard-realtime/dashboard-realtime.module';

@Module({
  imports: [
    SentryModule.forRoot(),
    PrismaModule,
    InventoryModule,
    PurchaseModule,
    VendorModule,
    SalesModule,
    CustomerModule,
    FinanceModule,
    BrandModule,
    SalesOrderModule,
    WorkshopModule,
    InvoicesModule,
    LaborModule,
    CatalogModule,
    VehicleModule,
    DashboardRealtimeModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
    {
      provide: APP_FILTER,
      useClass: SentryGlobalFilter,
    },
    {
      provide: APP_GUARD,
      useClass: ApiKeyGuard,
    },
  ],
})
export class AppModule {}
