import {
  MiddlewareConsumer,
  Module,
  NestModule,
  forwardRef,
} from '@nestjs/common';
import { APP_GUARD } from '@nestjs/core';
import { ThrottlerGuard, ThrottlerModule } from '@nestjs/throttler';
import { EventEmitterModule } from '@nestjs/event-emitter';
import { ScheduleModule } from '@nestjs/schedule';
import { AppController } from './app.controller.js';
import { AppService } from './app.service.js';
import { TenantContextMiddleware } from './common/services/tenant-context.middleware.js';
import { InventoryModule } from './inventory/inventory.module.js';
import { PrismaModule } from './prisma/prisma.module.js';
import { JwtAuthGuard } from './auth/jwt-auth.guard.js';
import { AUTH_THROTTLER_OPTIONS } from './auth/auth-throttling.js';
import { LANDING_DEMO_THROTTLER_OPTIONS } from './landing-demo-access/landing-demo-access.constants.js';
import { LandingDemoAccessModule } from './landing-demo-access/landing-demo-access.module.js';
import { ESTIMATE_APPROVAL_THROTTLER_OPTIONS } from './workshop/public-estimate-approval/public-estimate-approval.constants.js';
import { CONSENT_UNSUBSCRIBE_THROTTLER_OPTIONS } from './customer-consent/public-customer-consent-unsubscribe.constants.js';
import { PublicEstimateApprovalHeadersMiddleware } from './workshop/public-estimate-approval/public-estimate-approval.headers.middleware.js';
import { ApiKeyAuthGuard } from './public-api/api-keys/api-key.guard.js';
import { PublicApiModule } from './public-api/public-api.module.js';

import { PurchaseModule } from './purchase/purchase.module.js';
import { VendorModule } from './vendor/vendor.module.js';
import { SalesModule } from './sales/sales.module.js';
import { CustomerModule } from './customer/customer.module.js';
import { CustomerConsentModule } from './customer-consent/customer-consent.module.js';
import { FinanceModule } from './finance/finance.module.js';
import { BrandModule } from './brand/brand.module.js';
import { SalesOrderModule } from './sales/sales-order/sales-order.module.js';
import { WorkshopModule } from './workshop/workshop.module.js';
import { MechanicModule } from './mechanic/mechanic.module.js';
import { NotificationSenderModule } from './notifications/notification-sender.module.js';
import { InvoicesModule } from './invoices/invoices.module.js';
import { CreditNotesModule } from './credit-notes/credit-notes.module.js';
import { LaborModule } from './labor/labor.module.js';
import { CatalogModule } from './catalog/catalog.module.js';
import { VehicleModule } from './vehicle/vehicle.module.js';
import { VehicleStockModule } from './vehicle-stock/vehicle-stock.module.js';
import { VehicleEquipmentModule } from './vehicle/equipment/vehicle-equipment.module.js';
import { VehicleListingModule } from './vehicle/listing/vehicle-listing.module.js';
import { DashboardRealtimeModule } from './dashboard-realtime/dashboard-realtime.module.js';
import { EmployeeModule } from './employee/employee.module.js';
import { BayModule } from './bay/bay.module.js';
import { SiteModule } from './site/site.module.js';
import { AuthModule } from './auth/auth.module.js';
import { PlatformAdminModule } from './platform-admin/platform-admin.module.js';
import { TenantMemberModule } from './tenant-member/tenant-member.module.js';
import { TenantModule } from './tenant/tenant.module.js';
import { VoiceTranslationModule } from './voice-translation/voice-translation.module.js';
import { SettingsModule } from './settings/settings.module.js';
import { AuditModule } from './audit/audit.module.js';
import { AgentActionLogModule } from './agent-action-log/agent-action-log.module.js';
import { HrModule } from './hr/hr.module.js';
import { PartsRequisitionModule } from './parts-requisition/parts-requisition.module.js';
import { HealthController } from './health.controller.js';
import { StockTransferModule } from './stock-transfer/stock-transfer.module.js';
import { DocumentBrandingModule } from './document-branding/document-branding.module.js';
import { AppObservabilityModule } from './common/observability/observability.module.js';
import { LoanerVehiclesModule } from './loaner-vehicles/loaner-vehicles.module.js';
import { WarrantyClaimModule } from './warranty-claim/warranty-claim.module.js';
import { ImportModule } from './import/import.module.js';
import { TyreStorageModule } from './tyre-storage/tyre-storage.module.js';
import { AgentPolicyModule } from './agent-policy/agent-policy.module.js';
import { AgentProposalModule } from './agent-proposal/agent-proposal.module.js';
import { AgentSupervisionModule } from './agent-supervision/agent-supervision.module.js';
import { McpModule } from './mcp/mcp.module.js';
import { DecisionModule } from './decision/decision.module.js';
import { DecisionShadowLogModule } from './decision-shadow-log/decision-shadow-log.module.js';
import { DryRunModule } from './dry-run/dry-run.module.js';
import { MarginRuleModule } from './margin-rule/margin-rule.module.js';
import { SettlementModule } from './settlement/settlement.module.js';
import { SearchModule } from './search/search.module.js';

@Module({
  imports: [
    AppObservabilityModule.register(),
    forwardRef(() => PrismaModule),
    EventEmitterModule.forRoot(),
    ScheduleModule.forRoot(),
    ThrottlerModule.forRoot([
      AUTH_THROTTLER_OPTIONS,
      ESTIMATE_APPROVAL_THROTTLER_OPTIONS,
      CONSENT_UNSUBSCRIBE_THROTTLER_OPTIONS,
      LANDING_DEMO_THROTTLER_OPTIONS,
    ]),
    DryRunModule,
    InventoryModule,
    PurchaseModule,
    VendorModule,
    SalesModule,
    CustomerConsentModule,
    CustomerModule,
    FinanceModule,
    BrandModule,
    SalesOrderModule,
    WorkshopModule,
    LoanerVehiclesModule,
    WarrantyClaimModule,
    MechanicModule,
    NotificationSenderModule,
    InvoicesModule,
    CreditNotesModule,
    LaborModule,
    CatalogModule,
    VehicleModule,
    VehicleStockModule,
    VehicleEquipmentModule,
    VehicleListingModule,
    DashboardRealtimeModule,
    EmployeeModule,
    BayModule,
    SiteModule,
    StockTransferModule,
    AuthModule,
    PlatformAdminModule,
    TenantMemberModule,
    TenantModule,
    VoiceTranslationModule,
    SettingsModule,
    AuditModule,
    AgentActionLogModule,
    HrModule,
    PartsRequisitionModule,
    DocumentBrandingModule,
    ImportModule,
    TyreStorageModule,
    MarginRuleModule,
    SettlementModule,
    SearchModule,
    AgentPolicyModule,
    AgentProposalModule,
    AgentSupervisionModule,
    DecisionModule,
    DecisionShadowLogModule,
    McpModule,
    PublicApiModule,
    LandingDemoAccessModule,
  ],
  controllers: [AppController, HealthController],
  providers: [
    AppService,
    {
      provide: APP_GUARD,
      useClass: ThrottlerGuard,
    },
    // Order matters: API-key authentication must run before the Firebase session guard (ADR-0026).
    {
      provide: APP_GUARD,
      useClass: ApiKeyAuthGuard,
    },
    {
      provide: APP_GUARD,
      useClass: JwtAuthGuard,
    },
  ],
})
export class AppModule implements NestModule {
  configure(consumer: MiddlewareConsumer) {
    // The approval headers go first, so the tenant middleware's own answers on the route carry them too.
    consumer
      .apply(PublicEstimateApprovalHeadersMiddleware, TenantContextMiddleware)
      .forRoutes('{*path}');
  }
}
