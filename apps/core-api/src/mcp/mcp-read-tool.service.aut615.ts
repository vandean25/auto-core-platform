import { Injectable } from '@nestjs/common';
import type { z } from 'zod';
import type { McpReadToolName } from './mcp.constants.js';
import { McpAuditReadService } from './mcp-audit-read.service.js';
import { McpAvailabilityReadService } from './mcp-availability-read.service.js';
import { McpCapabilitiesService } from './mcp-capabilities.service.js';
import { McpCatalogReadService } from './mcp-catalog-read.service.js';
import { McpComplianceReadFacade } from './mcp-compliance-read.facade.js';
import { McpDocumentReadService } from './mcp-document-read.service.js';
import { McpInvoiceReadService } from './mcp-invoice-read.service.js';
import { McpListingReadService } from './mcp-listing-read.service.js';
import { McpOrderHistoryReadService } from './mcp-order-history-read.service.js';
import { McpPurchasingReadService } from './mcp-purchasing-read.service.js';
import { McpReadToolServiceAut605 } from './mcp-read-tool.service.aut605.js';
import { McpRecordReadService } from './mcp-record-read.service.js';
import { McpReportReadService } from './mcp-report-read.service.js';
import { McpSettingsReadService } from './mcp-settings-read.service.js';
import { McpStockReadService } from './mcp-stock-read.service.js';
import { McpVehicleContextReadService } from './mcp-vehicle-context-read.service.js';
import { McpWorkshopOrderDetailReadService } from './mcp-workshop-order-detail.read.service.js';
import type { McpToolCallContext } from './mcp-tool-handler.service.js';
import { getCapabilitiesWithWave2Reads } from './mcp-capabilities-read.aut615.js';
import type { getCapabilitiesInputSchema } from './mcp-tool-schemas.js';
import { McpWave2ReadFacade } from './mcp-wave2-read.facade.js';

@Injectable()
export class McpReadToolServiceAut615 extends McpReadToolServiceAut605 {
  private readonly capabilitiesForWave2: McpCapabilitiesService;

  constructor(
    capabilities: McpCapabilitiesService,
    auditReads: McpAuditReadService,
    invoiceReads: McpInvoiceReadService,
    recordReads: McpRecordReadService,
    listingReads: McpListingReadService,
    stockReads: McpStockReadService,
    orderHistoryReads: McpOrderHistoryReadService,
    vehicleContextReads: McpVehicleContextReadService,
    documentReads: McpDocumentReadService,
    settingsReads: McpSettingsReadService,
    purchasingReads: McpPurchasingReadService,
    catalogReads: McpCatalogReadService,
    reportReads: McpReportReadService,
    availabilityReads: McpAvailabilityReadService,
    workshopOrderDetailReads: McpWorkshopOrderDetailReadService,
    complianceReads: McpComplianceReadFacade,
    wave2Reads: McpWave2ReadFacade,
  ) {
    void wave2Reads;
    super(
      capabilities,
      auditReads,
      invoiceReads,
      recordReads,
      listingReads,
      stockReads,
      orderHistoryReads,
      vehicleContextReads,
      documentReads,
      settingsReads,
      purchasingReads,
      catalogReads,
      reportReads,
      availabilityReads,
      workshopOrderDetailReads,
      complianceReads,
    );
    this.capabilitiesForWave2 = capabilities;
  }

  override async run(
    toolName: McpReadToolName,
    parsed: unknown,
    context: McpToolCallContext,
  ): Promise<unknown> {
    if (toolName === 'get_capabilities') {
      return getCapabilitiesWithWave2Reads(
        this.capabilitiesForWave2,
        parsed as z.infer<typeof getCapabilitiesInputSchema>,
      );
    }
    return super.run(toolName, parsed, context);
  }
}
