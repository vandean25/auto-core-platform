import {
  MiddlewareConsumer,
  Module,
  NestModule,
  forwardRef,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TenantContextMiddleware } from './common/services/tenant-context.middleware.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { AUTH_THROTTLER_OPTIONS } from './auth/auth-throttling.js';

import { PurchaseModule } from './purchase/purchase.module.js';
import { VendorModule } from './vendor/vendor.module.js';
import { SalesModule } from './sales/sales.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { BrandModule } from './brand/brand.module.js';
import { SalesOrderModule } from './sales/sales-order/sales-order.module.js';
import { WorkshopModule } from './workshop/workshop.module.js';
import { MechanicModule } from './mechanic/mechanic.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { LaborModule } from './labor/labor.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { VehicleModule } from './vehicle/vehicle.module.js';
import { VehicleStockModule } from './vehicle-stock/vehicle-stock.module.js';
import { DashboardRealtimeModule } from './dashboard-realtime/dashboard-realtime.module.js';
import { EmployeeModule } from './employee/employee.module.js';
import { BayModule } from './bay/bay.module.js';
import { SiteModule } from './site/site.module.js';
import { AuthModule } from './auth/auth.module.js';
import { PlatformAdminModule } from './platform-admin/platform-admin.module.js';
import { TenantMemberModule } from './tenant-member/tenant-member.module.js';
import { VoiceTranslationModule } from './voice-translation/voice-translation.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { AuditModule } from './audit/audit.module.js';
import { HrModule } from './hr/hr.module.js';
import { PartsRequisitionModule } from './parts-requisition/parts-requisition.module.js';
import { HealthController } from './health.controller.js';

@Module({
  imports: [
    forwardRef(() => PrismaModule),
    EventEmitterModule.forRoot(),
    ThrottlerModule.forRoot([AUTH_THROTTLER_OPTIONS]),
    InventoryModule,
    PurchaseModule,
    VendorModule,
    SalesModule,
    CustomerModule,
    FinanceModule,
    BrandModule,
    SalesOrderModule,
    WorkshopModule,
    MechanicModule,
    InvoicesModule,
    LaborModule,
    CatalogModule,
    VehicleModule,
    VehicleStockModule,
    DashboardRealtimeModule,
    EmployeeModule,
    BayModule,
    SiteModule,
    AuthModule,
    PlatformAdminModule,
    TenantMemberModule,
    VoiceTranslationModule,
    SettingsModule,
    AuditModule,
    HrModule,
    PartsRequisitionModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    consumer.apply(TenantContextMiddleware).forRoutes('{*path}');
  }
}
