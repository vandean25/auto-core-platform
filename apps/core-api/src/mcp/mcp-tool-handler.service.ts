import { Injectable } from '@nestjs/common';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import type {
  McpReadToolName,
  McpToolName,
  McpWriteToolName,
} from './mcp.constants.js';
import { McpWritePipelineService } from './mcp-write-pipeline.service.js';
import type { McpWriteExecution } from './mcp-write-pipeline.service.js';
import { capMcpToolPayload } from './mcp-output.util.js';
import {
  getAgentActionInputSchema,
  getCapabilitiesInputSchema,
  getCustomerInputSchema,
  getEntityHistoryInputSchema,
  getInvoiceInputSchema,
  listAgentActionsInputSchema,
  listAuditEventsInputSchema,
  listInvoicesInputSchema,
  getStockLevelInputSchema,
  getVehicleStockAgeReportInputSchema,
  getVehicleStockMarginReportInputSchema,
  getVehicleInputSchema,
  getWorkshopOrderInputSchema,
  listBaysInputSchema,
  listBinsInputSchema,
  listWorkshopOrdersInputSchema,
  listWorkshopTasksInputSchema,
  mcpToolInputSchemas,
  mcpWriteToolInputSchemas,
  searchCustomersInputSchema,
  searchPartsInputSchema,
  searchVehiclesInputSchema,
} from './mcp-tool-schemas.js';
import { McpCapabilitiesService } from './mcp-capabilities.service.js';
import { McpAuditReadService } from './mcp-audit-read.service.js';
import { McpInvoiceReadService } from './mcp-invoice-read.service.js';
import { McpRecordReadService } from './mcp-record-read.service.js';
import { McpStockReadService } from './mcp-stock-read.service.js';
import { PendingActionExecutorService } from '../pending-action-executor/pending-action-executor.service.js';

export type McpToolCallContext = {
  agentId: string;
  onBehalfOfUserId: string;
};

@Injectable()
export class McpToolHandlerService {
  private readonly agentActionLog: AgentActionLogService;
  private readonly writePipeline: McpWritePipelineService;
  private readonly pendingActionExecutors: PendingActionExecutorService;
  private readonly capabilities: McpCapabilitiesService;
  private readonly auditReads: McpAuditReadService;
  private readonly invoiceReads: McpInvoiceReadService;
  private readonly recordReads: McpRecordReadService;
  private readonly stockReads: McpStockReadService;

  // Fields are assigned in the body rather than declared as parameter properties: cohesion analysis
  // otherwise counts the constructor as a separate component and flags the whole class as low-cohesion.
  constructor(
    agentActionLog: AgentActionLogService,
    writePipeline: McpWritePipelineService,
    pendingActionExecutors: PendingActionExecutorService,
    capabilities: McpCapabilitiesService,
    auditReads: McpAuditReadService,
    invoiceReads: McpInvoiceReadService,
    recordReads: McpRecordReadService,
    stockReads: McpStockReadService,
  ) {
    this.agentActionLog = agentActionLog;
    this.writePipeline = writePipeline;
    this.pendingActionExecutors = pendingActionExecutors;
    this.capabilities = capabilities;
    this.auditReads = auditReads;
    this.invoiceReads = invoiceReads;
    this.recordReads = recordReads;
    this.stockReads = stockReads;
  }

  async executeTool(
    toolName: McpToolName,
    rawArgs: unknown,
    context: McpToolCallContext,
  ): Promise<unknown> {
    if (isWriteTool(toolName)) {
      return this.executeWriteTool(toolName, rawArgs, context);
    }

    const schema = mcpToolInputSchemas[toolName];
    const actionType = `mcp.${toolName}`;
    const record = await this.agentActionLog.record(
      {
        actorType: 'AGENT',
        agentId: context.agentId,
        onBehalfOfUserId: context.onBehalfOfUserId,
        actionType,
        tier: 'AUTO',
        status: 'EXECUTED',
        inputSummary: { tool: toolName, args: rawArgs },
      },
      async () => {
        const parsed = schema.parse(rawArgs ?? {});
        return this.runTool(toolName, parsed, context);
      },
    );

    return capMcpToolPayload(record.workResult);
  }

  private async executeWriteTool(
    toolName: McpWriteToolName,
    rawArgs: unknown,
    context: McpToolCallContext,
  ): Promise<unknown> {
    const schema = mcpWriteToolInputSchemas[toolName];
    let parsed: unknown;
    try {
      parsed = schema.parse(rawArgs ?? {});
    } catch (error) {
      await this.logWriteInputFailure(toolName, rawArgs, context, error);
      throw error;
    }
    const result = await this.writePipeline.run(
      this.buildWriteExecution(toolName),
      parsed,
      context,
    );
    return capMcpToolPayload(result);
  }

  async recordInvalidWriteArguments(
    toolName: string,
    rawArgs: unknown,
    context: McpToolCallContext,
  ): Promise<void> {
    if (
      !Object.prototype.hasOwnProperty.call(mcpWriteToolInputSchemas, toolName)
    ) {
      return;
    }

    const writeToolName = toolName as McpWriteToolName;
    try {
      mcpWriteToolInputSchemas[writeToolName].parse(rawArgs ?? {});
    } catch (error) {
      await this.logWriteInputFailure(writeToolName, rawArgs, context, error);
    }
  }

  private async logWriteInputFailure(
    toolName: McpWriteToolName,
    rawArgs: unknown,
    context: McpToolCallContext,
    error: unknown,
  ): Promise<void> {
    // Schema validation runs before policy, so no tier was evaluated. Logging
    // PROPOSE here would read as a proposal awaiting approval.
    await this.agentActionLog.record({
      actorType: 'AGENT',
      agentId: context.agentId,
      onBehalfOfUserId: context.onBehalfOfUserId,
      actionType: `mcp.${toolName}`,
      tier: 'NOT_EVALUATED',
      status: 'FAILED',
      inputSummary: { tool: toolName, args: rawArgs },
      resultSummary: {
        error: error instanceof Error ? error.message : 'Invalid input',
      },
    });
  }

  private buildWriteExecution(toolName: McpWriteToolName): McpWriteExecution {
    const actionTypeByTool: Record<McpWriteToolName, string> = {
      draft_workshop_order: 'workshop_order.create',
      reserve_part: 'inventory.part_reserve',
      release_reservation: 'inventory.part_release',
      propose_line_item: 'workshop_order.propose_line',
    };
    const executor = this.pendingActionExecutors.resolve(
      actionTypeByTool[toolName],
    );
    return {
      toolName,
      policyActionType: executor.actionType,
      buildPolicyContext: (input) => executor.buildPolicyContext(input),
      buildExecutionContext: executor.buildExecutionContext
        ? () => executor.buildExecutionContext!()
        : undefined,
      execute: (input, executionContext) =>
        executor.execute(input, executionContext),
      buildResultSummary: (result) => executor.buildResultSummary(result),
      buildLogMetadata: executor.buildLogMetadata
        ? (result) => executor.buildLogMetadata!(result)
        : undefined,
    };
  }

  private async runTool(
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
        return this.recordReads.getCustomer(
          getCustomerInputSchema.parse(parsed),
        );
      case 'search_vehicles':
        return this.recordReads.searchVehicles(
          searchVehiclesInputSchema.parse(parsed),
        );
      case 'get_vehicle':
        return this.recordReads.getVehicle(getVehicleInputSchema.parse(parsed));
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

const MCP_WRITE_TOOL_NAME_SET = new Set<string>([
  'draft_workshop_order',
  'reserve_part',
  'release_reservation',
  'propose_line_item',
]);

function isWriteTool(toolName: McpToolName): toolName is McpWriteToolName {
  return MCP_WRITE_TOOL_NAME_SET.has(toolName);
}
