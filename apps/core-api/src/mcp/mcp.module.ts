import { Module } from '@nestjs/common';
import { AgentActionLogModule } from '../agent-action-log/agent-action-log.module.js';
import { AgentProposalModule } from '../agent-proposal/agent-proposal.module.js';
import { AgentPolicyModule } from '../agent-policy/agent-policy.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
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
    McpSessionService,
  ],
})
export class McpModule {}
