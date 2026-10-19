import { AgentActionLogModule } from '../agent-action-log/agent-action-log.module.js';
import { AgentProposalModule } from '../agent-proposal/agent-proposal.module.js';
import { AgentPolicyModule } from '../agent-policy/agent-policy.module.js';
import { AuthModule } from '../auth/auth.module.js';
import { CatalogModule } from '../catalog/catalog.module.js';
import { CommonModule } from '../common/common.module.js';
import { CustomerConsentModule } from '../customer-consent/customer-consent.module.js';
import { CustomerModule } from '../customer/customer.module.js';
import { DryRunModule } from '../dry-run/dry-run.module.js';
import { InventoryModule } from '../inventory/inventory.module.js';
import { InvoicesModule } from '../invoices/invoices.module.js';
import { LoanerVehiclesModule } from '../loaner-vehicles/loaner-vehicles.module.js';
import { PartsRequisitionModule } from '../parts-requisition/parts-requisition.module.js';
import { PendingActionExecutorModule } from '../pending-action-executor/pending-action-executor.module.js';
import { SiteModule } from '../site/site.module.js';
import { TyreStorageModule } from '../tyre-storage/tyre-storage.module.js';
import { VehicleModule } from '../vehicle/vehicle.module.js';
import { VehicleStockModule } from '../vehicle-stock/vehicle-stock.module.js';
import { VehicleStockQueryModule } from '../vehicle-stock/vehicle-stock-query.module.js';
import { WarrantyClaimModule } from '../warranty-claim/warranty-claim.module.js';
import { WorkshopModule } from '../workshop/workshop.module.js';
import { McpReadWave2Module } from './mcp-read-wave2.module.js';

export const MCP_NEST_IMPORTS = [
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
  McpReadWave2Module,
];
