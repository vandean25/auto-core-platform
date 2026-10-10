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
import { VehicleStockModule } from '../vehicle-stock/vehicle-stock.module.js';
import { McpAuditReadService } from './mcp-audit-read.service.js';
import { McpCapabilitiesService } from './mcp-capabilities.service.js';
import { McpDocumentReadService } from './mcp-document-read.service.js';
import { McpInvoiceReadService } from './mcp-invoice-read.service.js';
import { McpOrderHistoryReadService } from './mcp-order-history-read.service.js';
import { McpReadToolService } from './mcp-read-tool.service.js';
import { McpRecordReadService } from './mcp-record-read.service.js';
import { McpStockReadService } from './mcp-stock-read.service.js';
import { McpController } from './mcp.controller.js';
import { McpSessionService } from './mcp-session.service.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import { McpWritePipelineService } from './mcp-write-pipeline.service.js';

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
    PendingActionExecutorModule,
  ],
  controllers: [McpController],
  providers: [
    McpToolHandlerService,
    McpWritePipelineService,
    McpCapabilitiesService,
    McpAuditReadService,
    McpDocumentReadService,
    McpInvoiceReadService,
    McpOrderHistoryReadService,
    McpReadToolService,
    McpRecordReadService,
    McpStockReadService,
    McpSessionService,
  ],
})
export class McpModule {}
