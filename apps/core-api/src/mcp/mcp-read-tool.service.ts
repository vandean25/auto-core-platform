import { Injectable } from '@nestjs/common';
import type { McpReadToolName } from './mcp.constants.js';
import { McpAuditReadService } from './mcp-audit-read.service.js';
import { McpCapabilitiesService } from './mcp-capabilities.service.js';
import { McpDocumentReadService } from './mcp-document-read.service.js';
import { McpInvoiceReadService } from './mcp-invoice-read.service.js';
import { McpOrderHistoryReadService } from './mcp-order-history-read.service.js';
import { McpRecordReadService } from './mcp-record-read.service.js';
import { McpStockReadService } from './mcp-stock-read.service.js';
import type { McpToolCallContext } from './mcp-tool-handler.service.js';
import {
  getAgentActionInputSchema,
  getCapabilitiesInputSchema,
  getCustomerInputSchema,
  getDocumentPdfInputSchema,
  getEntityHistoryInputSchema,
  getInvoiceInputSchema,
  getStockLevelInputSchema,
  getVehicleHistoryInputSchema,
  getVehicleInputSchema,
  getVehicleStockAgeReportInputSchema,
  getVehicleStockMarginReportInputSchema,
  getWorkshopOrderInputSchema,
  listAgentActionsInputSchema,
  listAuditEventsInputSchema,
  listBaysInputSchema,
  listBinsInputSchema,
  listDocumentsInputSchema,
  listInvoicesInputSchema,
  listWorkshopOrdersInputSchema,
  listWorkshopTasksInputSchema,
  searchCustomersInputSchema,
  searchPartsInputSchema,
  searchVehiclesInputSchema,
} from './mcp-tool-schemas.js';

/**
 * Routes each read tool to the service that answers it. The tool handler keeps
 * the action log and the policy; this class holds only the read routing, so the
 * handler does not depend on every read service directly.
 */
@Injectable()
export class McpReadToolService {
  private readonly capabilities: McpCapabilitiesService;
  private readonly auditReads: McpAuditReadService;
  private readonly invoiceReads: McpInvoiceReadService;
  private readonly recordReads: McpRecordReadService;
  private readonly stockReads: McpStockReadService;
  private readonly orderHistoryReads: McpOrderHistoryReadService;
  private readonly documentReads: McpDocumentReadService;

  // Fields are assigned in the body rather than declared as parameter properties, for the same
  // cohesion reason as the tool handler.
  constructor(
    capabilities: McpCapabilitiesService,
    auditReads: McpAuditReadService,
    invoiceReads: McpInvoiceReadService,
    recordReads: McpRecordReadService,
    stockReads: McpStockReadService,
    orderHistoryReads: McpOrderHistoryReadService,
    documentReads: McpDocumentReadService,
  ) {
    this.capabilities = capabilities;
    this.auditReads = auditReads;
    this.invoiceReads = invoiceReads;
    this.recordReads = recordReads;
    this.stockReads = stockReads;
    this.orderHistoryReads = orderHistoryReads;
    this.documentReads = documentReads;
  }

  async run(
    toolName: McpReadToolName,
    parsed: unknown,
    context: McpToolCallContext,
  ): Promise<unknown> {
    switch (toolName) {
      case 'search_customers':
        return this.recordReads.searchCustomers(
          searchCustomersInputSchema.parse(parsed),
        );
      case 'get_customer':
        return this.orderHistoryReads.getCustomer(
          getCustomerInputSchema.parse(parsed),
        );
      case 'search_vehicles':
        return this.recordReads.searchVehicles(
          searchVehiclesInputSchema.parse(parsed),
        );
      case 'get_vehicle':
        return this.recordReads.getVehicle(getVehicleInputSchema.parse(parsed));
      case 'get_vehicle_history':
        return this.orderHistoryReads.getVehicleHistory(
          getVehicleHistoryInputSchema.parse(parsed),
        );
      case 'list_documents':
        return this.documentReads.listDocuments(
          listDocumentsInputSchema.parse(parsed),
        );
      case 'get_document_pdf':
        return this.documentReads.getDocumentPdf(
          getDocumentPdfInputSchema.parse(parsed),
        );
      case 'list_workshop_orders':
        return this.recordReads.listWorkshopOrders(
          listWorkshopOrdersInputSchema.parse(parsed),
        );
      case 'get_workshop_order':
        return this.recordReads.getWorkshopOrder(
          getWorkshopOrderInputSchema.parse(parsed),
        );
      case 'search_parts':
        return this.stockReads.searchParts(
          searchPartsInputSchema.parse(parsed),
        );
      case 'get_stock_level':
        return this.stockReads.getStockLevel(
          getStockLevelInputSchema.parse(parsed),
        );
      case 'get_vehicle_stock_age_report':
        return this.stockReads.vehicleStockAgeReport(
          getVehicleStockAgeReportInputSchema.parse(parsed),
        );
      case 'get_vehicle_stock_margin_report':
        return this.stockReads.vehicleStockMarginReport(
          getVehicleStockMarginReportInputSchema.parse(parsed),
        );
      case 'list_invoices':
        return this.invoiceReads.listInvoices(
          listInvoicesInputSchema.parse(parsed),
        );
      case 'get_invoice':
        return this.invoiceReads.getInvoice(
          getInvoiceInputSchema.parse(parsed),
        );
      case 'list_bays':
        return this.recordReads.listBays(listBaysInputSchema.parse(parsed));
      case 'list_bins':
        return this.recordReads.listBins(listBinsInputSchema.parse(parsed));
      case 'list_workshop_tasks':
        return this.recordReads.listWorkshopTasks(
          listWorkshopTasksInputSchema.parse(parsed),
        );
      case 'whoami':
        return this.capabilities.whoami(context);
      case 'get_capabilities':
        return this.capabilities.getCapabilities(
          getCapabilitiesInputSchema.parse(parsed),
        );
      case 'list_audit_events':
        return this.auditReads.listAuditEvents(
          listAuditEventsInputSchema.parse(parsed),
        );
      case 'get_entity_history':
        return this.auditReads.getEntityHistory(
          getEntityHistoryInputSchema.parse(parsed),
        );
      case 'get_agent_action':
        return this.auditReads.getAgentAction(
          getAgentActionInputSchema.parse(parsed),
        );
      case 'list_agent_actions':
        return this.auditReads.listAgentActions(
          listAgentActionsInputSchema.parse(parsed),
        );
    }
  }
}
