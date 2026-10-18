import { Injectable } from '@nestjs/common';
import type { McpReadToolName } from './mcp.constants.js';
import { McpAuditReadService } from './mcp-audit-read.service.js';
import { McpCapabilitiesService } from './mcp-capabilities.service.js';
import { McpCatalogReadService } from './mcp-catalog-read.service.js';
import { McpDocumentReadService } from './mcp-document-read.service.js';
import { McpInvoiceReadService } from './mcp-invoice-read.service.js';
import { McpOrderHistoryReadService } from './mcp-order-history-read.service.js';
import { McpVehicleContextReadService } from './mcp-vehicle-context-read.service.js';
import { McpPurchasingReadService } from './mcp-purchasing-read.service.js';
import { McpRecordReadService } from './mcp-record-read.service.js';
import { McpWorkshopOrderDetailReadService } from './mcp-workshop-order-detail.read.service.js';
import { McpAvailabilityReadService } from './mcp-availability-read.service.js';
import { McpComplianceReadFacade } from './mcp-compliance-read.facade.js';
import { McpReportReadService } from './mcp-report-read.service.js';
import { McpSettingsReadService } from './mcp-settings-read.service.js';
import { McpListingReadService } from './mcp-listing-read.service.js';
import { McpStockReadService } from './mcp-stock-read.service.js';
import type { McpToolCallContext } from './mcp-tool-handler.service.js';
import {
  getAgentActionInputSchema,
  getCapabilitiesInputSchema,
  getCatalogItemInputSchema,
  getCustomerInputSchema,
  getDocumentPdfInputSchema,
  getEntityHistoryInputSchema,
  getInvoiceInputSchema,
  getLegalEntityInputSchema,
  getNovaPreviewInputSchema,
  getRevenueReportInputSchema,
  getWorkshopKpiReportInputSchema,
  getPurchaseOrderInputSchema,
  getStockLevelInputSchema,
  getVehicleContextInputSchema,
  getVehicleHistoryInputSchema,
  getVehicleInputSchema,
  getVehicleListingStatusInputSchema,
  getVehicleStockAgeReportInputSchema,
  getVehicleStockMarginReportInputSchema,
  getWorkshopOrderInputSchema,
  listAgentActionsInputSchema,
  listAuditEventsInputSchema,
  listBaysInputSchema,
  listBinsInputSchema,
  listCatalogItemsInputSchema,
  listDocumentsInputSchema,
  listInvoicesInputSchema,
  listMarginRulesInputSchema,
  listPriceListsInputSchema,
  listPickerlDueInputSchema,
  checkContactPermissionInputSchema,
  listGewaehrleistungDueInputSchema,
  listTyreSetsInputSchema,
  listWarrantyClaimsInputSchema,
  listSitesInputSchema,
  listPurchaseOrdersInputSchema,
  listVendorsInputSchema,
  listWorkshopOrdersInputSchema,
  listWorkshopTasksInputSchema,
  listWorkshopSlotsInputSchema,
  listAvailableLoanersInputSchema,
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
  private readonly listingReads: McpListingReadService;
  private readonly stockReads: McpStockReadService;
  private readonly orderHistoryReads: McpOrderHistoryReadService;
  private readonly vehicleContextReads: McpVehicleContextReadService;
  private readonly documentReads: McpDocumentReadService;
  private readonly settingsReads: McpSettingsReadService;
  private readonly purchasingReads: McpPurchasingReadService;
  private readonly catalogReads: McpCatalogReadService;
  private readonly reportReads: McpReportReadService;
  private readonly availabilityReads: McpAvailabilityReadService;
  private readonly workshopOrderDetailReads: McpWorkshopOrderDetailReadService;
  private readonly complianceReads: McpComplianceReadFacade;

  // Fields are assigned in the body rather than declared as parameter properties, for the same
  // cohesion reason as the tool handler.
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
    complianceReads: McpComplianceReadFacade = {} as McpComplianceReadFacade,
  ) {
    this.capabilities = capabilities;
    this.auditReads = auditReads;
    this.invoiceReads = invoiceReads;
    this.recordReads = recordReads;
    this.listingReads = listingReads;
    this.stockReads = stockReads;
    this.orderHistoryReads = orderHistoryReads;
    this.vehicleContextReads = vehicleContextReads;
    this.documentReads = documentReads;
    this.settingsReads = settingsReads;
    this.purchasingReads = purchasingReads;
    this.catalogReads = catalogReads;
    this.reportReads = reportReads;
    this.availabilityReads = availabilityReads;
    this.workshopOrderDetailReads = workshopOrderDetailReads;
    this.complianceReads = complianceReads;
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
      case 'get_vehicle_listing_status':
        return this.listingReads.getVehicleListingStatus(
          getVehicleListingStatusInputSchema.parse(parsed),
        );
      case 'get_vehicle_history':
        return this.orderHistoryReads.getVehicleHistory(
          getVehicleHistoryInputSchema.parse(parsed),
        );
      case 'get_vehicle_context':
        return this.vehicleContextReads.getVehicleContext(
          getVehicleContextInputSchema.parse(parsed),
        );
      case 'list_documents':
        return this.documentReads.listDocuments(
          listDocumentsInputSchema.parse(parsed),
        );
      case 'get_document_pdf':
        return this.documentReads.getDocumentPdf(
          getDocumentPdfInputSchema.parse(parsed),
        );
      case 'list_purchase_orders':
        return this.purchasingReads.listPurchaseOrders(
          listPurchaseOrdersInputSchema.parse(parsed),
        );
      case 'get_purchase_order':
        return this.purchasingReads.getPurchaseOrder(
          getPurchaseOrderInputSchema.parse(parsed),
        );
      case 'list_vendors':
        return this.purchasingReads.listVendors(
          listVendorsInputSchema.parse(parsed),
        );
      case 'get_workshop_kpi_report':
        return this.reportReads.getWorkshopKpiReport(
          getWorkshopKpiReportInputSchema.parse(parsed),
        );
      case 'get_revenue_report':
        return this.reportReads.getRevenueReport(
          getRevenueReportInputSchema.parse(parsed),
        );
      case 'list_pickerl_due':
        return this.reportReads.listPickerlDue(
          listPickerlDueInputSchema.parse(parsed),
        );
      case 'get_nova_preview':
        return this.reportReads.getNovaPreview(
          getNovaPreviewInputSchema.parse(parsed),
        );
      case 'check_contact_permission':
        return this.complianceReads.checkContactPermission(
          checkContactPermissionInputSchema.parse(parsed),
        );
      case 'list_gewaehrleistung_due':
        return this.complianceReads.listGewaehrleistungDue(
          listGewaehrleistungDueInputSchema.parse(parsed),
        );
      case 'list_tyre_sets':
        return this.complianceReads.listTyreSets(
          listTyreSetsInputSchema.parse(parsed),
        );
      case 'list_warranty_claims':
        return this.complianceReads.listWarrantyClaims(
          listWarrantyClaimsInputSchema.parse(parsed),
        );
      case 'list_workshop_orders':
        return this.recordReads.listWorkshopOrders(
          listWorkshopOrdersInputSchema.parse(parsed),
        );
      case 'get_workshop_order':
        return this.workshopOrderDetailReads.getWorkshopOrder(
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
      case 'list_workshop_slots':
        return this.availabilityReads.listWorkshopSlots(
          listWorkshopSlotsInputSchema.parse(parsed),
        );
      case 'list_available_loaners':
        return this.availabilityReads.listAvailableLoaners(
          listAvailableLoanersInputSchema.parse(parsed),
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
      case 'get_tenant_settings':
        return this.settingsReads.getTenantSettings();
      case 'list_sites':
        return this.settingsReads.listSites(listSitesInputSchema.parse(parsed));
      case 'get_legal_entity':
        return this.settingsReads.getLegalEntity(
          getLegalEntityInputSchema.parse(parsed),
        );
      case 'list_catalog_items':
        return this.catalogReads.listCatalogItems(
          listCatalogItemsInputSchema.parse(parsed),
        );
      case 'get_catalog_item':
        return this.catalogReads.getCatalogItem(
          getCatalogItemInputSchema.parse(parsed),
        );
      case 'list_price_lists':
        return this.catalogReads.listPriceLists(
          listPriceListsInputSchema.parse(parsed),
        );
      case 'list_margin_rules':
        return this.catalogReads.listMarginRules(
          listMarginRulesInputSchema.parse(parsed),
        );
    }
  }
}
