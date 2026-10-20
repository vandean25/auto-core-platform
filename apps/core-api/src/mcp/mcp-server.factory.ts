import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import {
  MCP_TOOL_NAMES,
  MCP_SERVER_IMPLEMENTATION,
  type McpToolName,
} from './mcp.constants.js';
import { McpToolHandlerService } from './mcp-tool-handler.service.js';
import { toMcpJsonObject } from './mcp-output.util.js';
import { MCP_TOOL_DESCRIPTIONS } from './mcp-tool-descriptions.js';
import { mcpToolOutputSchemas } from './mcp-tool-output-schemas.js';
import type { z } from 'zod';
import * as schemas from './mcp-tool-schemas.js';

type McpRegisterToolInputSchema = z.ZodTypeAny | Record<string, z.ZodTypeAny>;

/** Registered MCP tool input shapes (for tools/list and contract tests). */
export const MCP_REGISTERED_TOOL_INPUT_SCHEMAS: Record<
  McpToolName,
  McpRegisterToolInputSchema
> = {
  search_customers: schemas.searchCustomersInputSchema.shape,
  get_customer: schemas.getCustomerInputSchema.shape,
  get_vehicle: schemas.getVehicleInputSchema.shape,
  get_vehicle_listing_status: schemas.getVehicleListingStatusInputSchema.shape,
  search_vehicles: schemas.searchVehiclesInputSchema.shape,
  list_workshop_orders: schemas.listWorkshopOrdersBaseSchema.shape,
  get_workshop_order: schemas.getWorkshopOrderInputSchema.shape,
  search_parts: schemas.searchPartsInputSchema.shape,
  get_stock_level: schemas.getStockLevelBaseSchema.shape,
  get_vehicle_stock_age_report:
    schemas.getVehicleStockAgeReportBaseSchema.shape,
  get_vehicle_stock_margin_report:
    schemas.getVehicleStockMarginReportBaseSchema.shape,
  list_invoices: schemas.listInvoicesBaseSchema.shape,
  get_invoice: schemas.getInvoiceInputSchema.shape,
  list_bays: schemas.listBaysInputSchema.shape,
  list_bins: schemas.listBinsInputSchema.shape,
  list_workshop_tasks: schemas.listWorkshopTasksInputSchema.shape,
  list_workshop_slots: schemas.listWorkshopSlotsInputSchema.shape,
  list_available_loaners: schemas.listAvailableLoanersInputSchema.shape,
  whoami: schemas.whoamiInputSchema.shape,
  get_capabilities: schemas.getCapabilitiesInputSchema.shape,
  list_audit_events: schemas.listAuditEventsBaseSchema.shape,
  get_entity_history: schemas.getEntityHistoryInputSchema.shape,
  get_agent_action: schemas.getAgentActionInputSchema.shape,
  list_agent_actions: schemas.listAgentActionsBaseSchema.shape,
  get_vehicle_history: schemas.getVehicleHistoryInputSchema.shape,
  get_vehicle_context: schemas.getVehicleContextInputSchema.shape,
  list_documents: schemas.listDocumentsBaseSchema.shape,
  get_document_pdf: schemas.getDocumentPdfInputSchema.shape,
  get_tenant_settings: schemas.getTenantSettingsInputSchema.shape,
  list_sites: schemas.listSitesInputSchema.shape,
  get_legal_entity: schemas.getLegalEntityInputSchema.shape,
  list_purchase_orders: schemas.listPurchaseOrdersBaseSchema.shape,
  get_purchase_order: schemas.getPurchaseOrderInputSchema.shape,
  list_vendors: schemas.listVendorsInputSchema.shape,
  list_catalog_items: schemas.listCatalogItemsInputSchema.shape,
  get_catalog_item: schemas.getCatalogItemInputSchema.shape,
  list_price_lists: schemas.listPriceListsInputSchema.shape,
  list_margin_rules: schemas.listMarginRulesInputSchema.shape,
  get_workshop_kpi_report: schemas.getWorkshopKpiReportBaseSchema.shape,
  get_revenue_report: schemas.getRevenueReportBaseSchema.shape,
  list_pickerl_due: schemas.listPickerlDueInputSchema.shape,
  get_nova_preview: schemas.getNovaPreviewInputSchema.shape,
  draft_workshop_order: schemas.mcpWriteToolInputSchemas.draft_workshop_order,
  reserve_part: schemas.mcpWriteToolInputSchemas.reserve_part,
  release_reservation: schemas.mcpWriteToolInputSchemas.release_reservation,
  propose_line_item: schemas.mcpWriteToolInputSchemas.propose_line_item,
  propose_registration_intake:
    schemas.mcpWriteToolInputSchemas.propose_registration_intake,
  propose_workshop_booking:
    schemas.mcpWriteToolInputSchemas.propose_workshop_booking,
  propose_purchase_order:
    schemas.mcpWriteToolInputSchemas.propose_purchase_order,
  propose_workshop_order_completion:
    schemas.mcpWriteToolInputSchemas.propose_workshop_order_completion,
  propose_invoice_draft_from_order:
    schemas.mcpWriteToolInputSchemas.propose_invoice_draft_from_order,
  propose_estimate_send: schemas.mcpWriteToolInputSchemas.propose_estimate_send,
  request_workshop_media_upload:
    schemas.mcpWriteToolInputSchemas.request_workshop_media_upload,
  propose_mechanic_finding:
    schemas.mcpWriteToolInputSchemas.propose_mechanic_finding,
  propose_customer_create:
    schemas.mcpWriteToolInputSchemas.propose_customer_create,
  propose_customer_update:
    schemas.mcpWriteToolInputSchemas.propose_customer_update,
  generate_weekly_report_pdf:
    schemas.mcpWriteToolInputSchemas.generate_weekly_report_pdf,
};

export type McpServerSessionContext = {
  agentId: string;
  onBehalfOfUserId: string;
};

export function createMcpServer(
  toolHandler: McpToolHandlerService,
  session: McpServerSessionContext,
): McpServer {
  const server = new McpServer(MCP_SERVER_IMPLEMENTATION, {
    capabilities: { tools: {} },
  });

  for (const toolName of MCP_TOOL_NAMES) {
    server.registerTool(
      toolName,
      {
        description: MCP_TOOL_DESCRIPTIONS[toolName],
        inputSchema: MCP_REGISTERED_TOOL_INPUT_SCHEMAS[toolName],
        outputSchema: mcpToolOutputSchemas[toolName],
      },
      async (args) => {
        const result = await toolHandler.executeTool(toolName, args, {
          agentId: session.agentId,
          onBehalfOfUserId: session.onBehalfOfUserId,
        });
        return {
          content: [
            {
              type: 'text' as const,
              text: JSON.stringify(result),
            },
          ],
          structuredContent: toMcpJsonObject(result),
        };
      },
    );
  }

  return server;
}
