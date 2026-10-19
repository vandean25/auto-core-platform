import { McpAuditReadService } from './mcp-audit-read.service.js';
import { McpAvailabilityReadService } from './mcp-availability-read.service.js';
import { McpCapabilitiesService } from './mcp-capabilities.service.js';
import { McpCatalogReadService } from './mcp-catalog-read.service.js';
import { McpComplianceReadFacade } from './mcp-compliance-read.facade.js';
import { McpComplianceReadListsService } from './mcp-compliance-read-lists.service.js';
import { McpComplianceReadService } from './mcp-compliance-read.service.js';
import { McpDocumentReadService } from './mcp-document-read.service.js';
import { McpInvoiceReadService } from './mcp-invoice-read.service.js';
import { McpListingReadService } from './mcp-listing-read.service.js';
import { McpOrderHistoryReadService } from './mcp-order-history-read.service.js';
import { McpPurchasingReadService } from './mcp-purchasing-read.service.js';
import { McpRecordReadService } from './mcp-record-read.service.js';
import { McpReportReadService } from './mcp-report-read.service.js';
import { McpSettingsReadService } from './mcp-settings-read.service.js';
import { McpStockReadService } from './mcp-stock-read.service.js';
import { McpToolHandlerComplianceWrapper } from './mcp-tool-handler.compliance-wrapper.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import { McpUserLocaleService } from './mcp-user-locale.service.js';
import { McpVehicleContextReadService } from './mcp-vehicle-context-read.service.js';
import { McpWorkshopOrderReadService } from './mcp-workshop-order-read.service.js';
import { McpWriteCommandIdempotencyService } from './mcp-write-command-idempotency.service.js';
import { McpWritePipelineService } from './mcp-write-pipeline.service.js';
import { MCP_STACK_PROVIDERS_WAVE2 } from './mcp-stack.providers.wave2.js';

export const MCP_NEST_PROVIDERS = [
  McpToolHandlerService,
  McpToolHandlerComplianceWrapper,
  McpWritePipelineService,
  McpWriteCommandIdempotencyService,
  McpCapabilitiesService,
  McpAuditReadService,
  McpDocumentReadService,
  McpInvoiceReadService,
  McpOrderHistoryReadService,
  McpVehicleContextReadService,
  McpPurchasingReadService,
  ...MCP_STACK_PROVIDERS_WAVE2,
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
  McpUserLocaleService,
];
