import { Module } from '@nestjs/common';
import { AgentActionLogModule } from '../agent-action-log/agent-action-log.module.js';
import { AgentProposalModule } from '../agent-proposal/agent-proposal.module.js';
import { AgentPolicyModule } from '../agent-policy/agent-policy.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CommonModule } from '../common/common.module.js';
import { CustomerModule } from '../customer/customer.module.js';
import { DryRunModule } from '../dry-run/dry-run.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { PartsRequisitionModule } from '../parts-requisition/parts-requisition.module.js';
import { PendingActionExecutorModule } from '../pending-action-executor/pending-action-executor.module.js';
import { VehicleModule } from '../vehicle/vehicle.module.js';
import { WorkshopModule } from '../workshop/workshop.module.js';
import { CustomerConsentModule } from '../customer-consent/customer-consent.module.js';
import { TyreStorageModule } from '../tyre-storage/tyre-storage.module.js';
import { VehicleStockModule } from '../vehicle-stock/vehicle-stock.module.js';
import { VehicleStockQueryModule } from '../vehicle-stock/vehicle-stock-query.module.js';
import { WarrantyClaimModule } from '../warranty-claim/warranty-claim.module.js';
import { McpComplianceReadFacade } from './mcp-compliance-read.facade.js';
import { McpComplianceReadListsService } from './mcp-compliance-read-lists.service.js';
import { McpComplianceReadService } from './mcp-compliance-read.service.js';
import { LoanerVehiclesModule } from '../loaner-vehicles/loaner-vehicles.module.js';
import { McpAuditReadService } from './mcp-audit-read.service.js';
import { McpCapabilitiesService } from './mcp-capabilities.service.js';
import { McpDocumentReadService } from './mcp-document-read.service.js';
import { McpInvoiceReadService } from './mcp-invoice-read.service.js';
import { McpOrderHistoryReadService } from './mcp-order-history-read.service.js';
import { McpVehicleContextReadService } from './mcp-vehicle-context-read.service.js';
import { McpPurchasingReadService } from './mcp-purchasing-read.service.js';
import { McpToolHandlerComplianceWrapper } from './mcp-tool-handler.compliance-wrapper.js';
import { McpRecordReadService } from './mcp-record-read.service.js';
import { McpWorkshopOrderReadService } from './mcp-workshop-order-read.service.js';
import { McpCatalogReadService } from './mcp-catalog-read.service.js';
import { McpAvailabilityReadService } from './mcp-availability-read.service.js';
import { McpReportReadService } from './mcp-report-read.service.js';
import { McpSettingsReadService } from './mcp-settings-read.service.js';
import { McpListingReadService } from './mcp-listing-read.service.js';
import { McpStockReadService } from './mcp-stock-read.service.js';
import { McpController } from './mcp.controller.js';
import { MCP_STACK_PROVIDERS_AUT615 } from './mcp-stack.providers.aut615.js';
import { HrModule } from '../hr/hr.module.js';
import { McpWave2ReadListsService } from './mcp-wave2-read-lists.service.js';
import { McpWave2ReadFacade } from './mcp-wave2-read.facade.js';
import { McpToolHandlerWave2Wrapper } from './mcp-tool-handler.wave2-wrapper.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import { McpWritePipelineService } from './mcp-write-pipeline.service.js';
import { McpWriteCommandIdempotencyService } from './mcp-write-command-idempotency.service.js';
import { McpUserLocaleService } from './mcp-user-locale.service.js';
import { SiteModule } from '../site/site.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';

@Module({
  imports: [
    AuthModule,
    AgentActionLogModule,
    AgentProposalModule,
    AgentPolicyModule,
    CommonModule,
    DryRunModule,
    CustomerModule,
    VehicleModule,
    WorkshopModule,
    CatalogModule,
    InventoryModule,
    PartsRequisitionModule,
    VehicleStockModule,
    VehicleStockQueryModule,
    CustomerConsentModule,
    TyreStorageModule,
    WarrantyClaimModule,
    LoanerVehiclesModule,
    PendingActionExecutorModule,
    SiteModule,
    InvoicesModule,
    HrModule,
  ],
  controllers: [McpController],
  providers: [
    McpToolHandlerService,
    McpToolHandlerComplianceWrapper,
    McpToolHandlerWave2Wrapper,
    McpWritePipelineService,
    McpWriteCommandIdempotencyService,
    McpCapabilitiesService,
    McpAuditReadService,
    McpDocumentReadService,
    McpInvoiceReadService,
    McpOrderHistoryReadService,
    McpVehicleContextReadService,
    McpPurchasingReadService,
    ...MCP_STACK_PROVIDERS_AUT615,
    McpRecordReadService,
    McpWorkshopOrderReadService,
    McpCatalogReadService,
    McpReportReadService,
    McpAvailabilityReadService,
    McpSettingsReadService,
    McpListingReadService,
    McpStockReadService,
    McpComplianceReadService,
    McpComplianceReadListsService,
    McpComplianceReadFacade,
    McpWave2ReadListsService,
    McpWave2ReadFacade,
    McpUserLocaleService,
  ],
})
export class McpModule {}
