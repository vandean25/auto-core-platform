import { Injectable } from '@nestjs/common';
import type { McpReadToolName } from './mcp.constants.js';
import { McpComplianceReadFacade } from './mcp-compliance-read.facade.js';
import { McpCapabilitiesService } from './mcp-capabilities.service.js';
import { McpReadToolService } from './mcp-read-tool.service.js';
import type { McpToolCallContext } from './mcp-tool-handler.service.js';
import { getCapabilitiesWithComplianceReads } from './mcp-capabilities-read.aut605.js';
import type { getCapabilitiesInputSchema } from './mcp-tool-schemas.js';
import type { z } from 'zod';

/**
 * Extends {@link McpReadToolService} so get_capabilities lists AUT-605 tools without
 * editing the core read router.
 */
@Injectable()
export class McpReadToolServiceAut605 extends McpReadToolService {
  private readonly capabilitiesService: McpCapabilitiesService;

  constructor(
    capabilities: McpCapabilitiesService,
    auditReads: ConstructorParameters<typeof McpReadToolService>[1],
    invoiceReads: ConstructorParameters<typeof McpReadToolService>[2],
    recordReads: ConstructorParameters<typeof McpReadToolService>[3],
    listingReads: ConstructorParameters<typeof McpReadToolService>[4],
    stockReads: ConstructorParameters<typeof McpReadToolService>[5],
    orderHistoryReads: ConstructorParameters<typeof McpReadToolService>[6],
    vehicleContextReads: ConstructorParameters<typeof McpReadToolService>[7],
    documentReads: ConstructorParameters<typeof McpReadToolService>[8],
    settingsReads: ConstructorParameters<typeof McpReadToolService>[9],
    purchasingReads: ConstructorParameters<typeof McpReadToolService>[10],
    catalogReads: ConstructorParameters<typeof McpReadToolService>[11],
    reportReads: ConstructorParameters<typeof McpReadToolService>[12],
    availabilityReads: ConstructorParameters<typeof McpReadToolService>[13],
    workshopOrderDetailReads: ConstructorParameters<typeof McpReadToolService>[14],
    _complianceReads: McpComplianceReadFacade,
  ) {
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
    );
    this.capabilitiesService = capabilities;
  }

  override async run(
    toolName: McpReadToolName,
    parsed: unknown,
    _context: McpToolCallContext,
  ): Promise<unknown> {
    if (toolName === 'get_capabilities') {
      return getCapabilitiesWithComplianceReads(
        this.capabilitiesService,
        parsed as z.infer<typeof getCapabilitiesInputSchema>,
      );
    }
    return super.run(toolName, parsed, _context);
  }
}
