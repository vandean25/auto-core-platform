import type { McpAuditReadService } from './mcp-audit-read.service.js';
import type { McpAvailabilityReadService } from './mcp-availability-read.service.js';
import type { McpCapabilitiesService } from './mcp-capabilities.service.js';
import type { McpCatalogReadService } from './mcp-catalog-read.service.js';
import type { McpDocumentReadService } from './mcp-document-read.service.js';
import type { McpInvoiceReadService } from './mcp-invoice-read.service.js';
import type { McpListingReadService } from './mcp-listing-read.service.js';
import type { McpOrderHistoryReadService } from './mcp-order-history-read.service.js';
import type { McpPurchasingReadService } from './mcp-purchasing-read.service.js';
import type { McpRecordReadService } from './mcp-record-read.service.js';
import type { McpReportReadService } from './mcp-report-read.service.js';
import type { McpSettingsReadService } from './mcp-settings-read.service.js';
import type { McpStockReadService } from './mcp-stock-read.service.js';
import type { McpVehicleContextReadService } from './mcp-vehicle-context-read.service.js';
import type { McpWorkshopOrderDetailReadService } from './mcp-workshop-order-detail.read.service.js';
import { McpReadToolService } from './mcp-read-tool.service.js';

const stub = {} as never;

export type McpReadToolServiceTestDeps = {
  capabilities?: McpCapabilitiesService;
  auditReads?: McpAuditReadService;
  invoiceReads?: McpInvoiceReadService;
  recordReads?: McpRecordReadService;
  listingReads?: McpListingReadService;
  stockReads?: McpStockReadService;
  orderHistoryReads?: McpOrderHistoryReadService;
  vehicleContextReads?: McpVehicleContextReadService;
  documentReads?: McpDocumentReadService;
  settingsReads?: McpSettingsReadService;
  purchasingReads?: McpPurchasingReadService;
  catalogReads?: McpCatalogReadService;
  reportReads?: McpReportReadService;
  availabilityReads?: McpAvailabilityReadService;
  workshopOrderDetailReads?: McpWorkshopOrderDetailReadService;
};

/** Builds {@link McpReadToolService} for handler specs without repeating sixteen constructor args. */
export function createMcpReadToolServiceForTest(
  deps: McpReadToolServiceTestDeps = {},
): McpReadToolService {
  return new McpReadToolService(
    deps.capabilities ?? stub,
    deps.auditReads ?? stub,
    deps.invoiceReads ?? stub,
    deps.recordReads ?? stub,
    deps.listingReads ?? stub,
    deps.stockReads ?? stub,
    deps.orderHistoryReads ?? stub,
    deps.vehicleContextReads ?? stub,
    deps.documentReads ?? stub,
    deps.settingsReads ?? stub,
    deps.purchasingReads ?? stub,
    deps.catalogReads ?? stub,
    deps.reportReads ?? stub,
    deps.availabilityReads ?? stub,
    deps.workshopOrderDetailReads ?? stub,
  );
}
