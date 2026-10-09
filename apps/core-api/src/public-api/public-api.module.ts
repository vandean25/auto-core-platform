import { Module } from '@nestjs/common';
import { AgentActionLogModule } from '../agent-action-log/agent-action-log.module.js';
import { AuditModule } from '../audit/audit.module.js';
import { CommonModule } from '../common/common.module.js';
import { PrismaModule } from '../prisma/prisma.module.js';
import { ApiKeyAuthenticatorService } from './api-keys/api-key-authenticator.service.js';
import { ApiKeyLookupService } from './api-keys/api-key-lookup.service.js';
import { ApiKeyRequestAuditInterceptor } from './api-keys/api-key-request-audit.interceptor.js';
import { ApiKeyRequestAuditService } from './api-keys/api-key-request-audit.service.js';
import { TenantApiKeyController } from './api-keys/tenant-api-key.controller.js';
import { TenantApiKeyService } from './api-keys/tenant-api-key.service.js';
import { PublicApiReadService } from './v1/public-api-read.service.js';
import { PublicCustomersController } from './v1/public-customers.controller.js';
import { PublicInvoicesController } from './v1/public-invoices.controller.js';
import { PublicStockController } from './v1/public-stock.controller.js';
import { PublicVehiclesController } from './v1/public-vehicles.controller.js';
import { PublicWorkshopOrdersController } from './v1/public-workshop-orders.controller.js';

/**
 * Tenant API keys and the read-only public API (ADR-0026). AppModule registers ApiKeyAuthGuard as a
 * global guard, ordered before the Firebase session guard.
 */
@Module({
  imports: [PrismaModule, CommonModule, AuditModule, AgentActionLogModule],
  controllers: [
    TenantApiKeyController,
    PublicCustomersController,
    PublicVehiclesController,
    PublicInvoicesController,
    PublicWorkshopOrdersController,
    PublicStockController,
  ],
  providers: [
    ApiKeyLookupService,
    ApiKeyAuthenticatorService,
    ApiKeyRequestAuditService,
    ApiKeyRequestAuditInterceptor,
    TenantApiKeyService,
    PublicApiReadService,
  ],
  exports: [
    ApiKeyAuthenticatorService,
    ApiKeyRequestAuditService,
    ApiKeyRequestAuditInterceptor,
  ],
})
export class PublicApiModule {}
