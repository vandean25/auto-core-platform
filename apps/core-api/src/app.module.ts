import {
  MiddlewareConsumer,
  Module,
  NestModule,
  forwardRef,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { TenantContextMiddleware } from './common/services/tenant-context.middleware';
import { InventoryModule } from './inventory/inventory.module';
import { PrismaModule } from './prisma/prisma.module';
import { JwtAuthGuard } from './auth/jwt-auth.guard';

import { PurchaseModule } from './purchase/purchase.module';
import { VendorModule } from './vendor/vendor.module';
import { SalesModule } from './sales/sales.module';
import { CustomerModule } from './customer/customer.module';
import { FinanceModule } from './finance/finance.module';
import { BrandModule } from './brand/brand.module';
import { SalesOrderModule } from './sales/sales-order/sales-order.module';
import { WorkshopModule } from './workshop/workshop.module';
import { MechanicModule } from './mechanic/mechanic.module';
import { InvoicesModule } from './invoices/invoices.module';
import { LaborModule } from './labor/labor.module';
import { CatalogModule } from './catalog/catalog.module';
import { VehicleModule } from './vehicle/vehicle.module';
import { DashboardRealtimeModule } from './dashboard-realtime/dashboard-realtime.module';
import { EmployeeModule } from './employee/employee.module';
import { BayModule } from './bay/bay.module';
import { AuthModule } from './auth/auth.module';
import { PlatformAdminModule } from './platform-admin/platform-admin.module';
import { TenantMemberModule } from './tenant-member/tenant-member.module';
import { VoiceTranslationModule } from './voice-translation/voice-translation.module';
import { AuditModule } from './audit/audit.module';

@Module({
  imports: [
    forwardRef(() => PrismaModule),
    EventEmitterModule.forRoot(),
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
    DashboardRealtimeModule,
    EmployeeModule,
    BayModule,
    AuthModule,
    PlatformAdminModule,
    TenantMemberModule,
    VoiceTranslationModule,
    AuditModule,
  ],
  controllers: [AppController],
  providers: [
    AppService,
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
