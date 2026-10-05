import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { z } from 'zod';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { MCP_WRITE_POLICY_ACTION_TYPES } from '../agent-policy/agent-policy.constants.js';
import type { AgentPolicyEvaluateContext } from '../agent-policy/agent-policy.types.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { CustomerService } from '../customer/customer.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PartsRequisitionService } from '../parts-requisition/parts-requisition.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../common/services/site-context.service.js';
import { VehicleService } from '../vehicle/vehicle.service.js';
import { WorkshopIntakeService } from '../workshop/workshop-intake.service.js';
import type {
  McpReadToolName,
  McpToolName,
  McpWriteToolName,
} from './mcp.constants.js';
import { McpWritePipelineService } from './mcp-write-pipeline.service.js';
import type { McpWriteExecution } from './mcp-write-pipeline.service.js';
import {
  capMcpToolPayload,
  clampMcpPage,
  clampMcpPageSize,
} from './mcp-output.util.js';
import {
  draftWorkshopOrderInputSchema,
  getCustomerInputSchema,
  getStockLevelInputSchema,
  getVehicleInputSchema,
  getWorkshopOrderInputSchema,
  listWorkshopOrdersInputSchema,
  mcpToolInputSchemas,
  mcpWriteToolInputSchemas,
  proposeLineItemInputSchema,
  releaseReservationInputSchema,
  reservePartInputSchema,
  searchCustomersInputSchema,
  searchPartsInputSchema,
  searchVehiclesInputSchema,
} from './mcp-tool-schemas.js';
import { formatMcpAgentId } from './mcp-agent-id.util.js';

export type McpToolCallContext = {
  agentId: string;
  onBehalfOfUserId: string;
};

type DraftWorkshopOrderInput = z.infer<typeof draftWorkshopOrderInputSchema>;
type ReservePartInput = z.infer<typeof reservePartInputSchema>;
type ReleaseReservationInput = z.infer<typeof releaseReservationInputSchema>;
type ProposeLineItemInput = z.infer<typeof proposeLineItemInputSchema>;

@Injectable()
export class McpToolHandlerService {
  constructor(
    private readonly agentActionLog: AgentActionLogService,
    private readonly customerService: CustomerService,
    private readonly vehicleService: VehicleService,
    private readonly workshopIntakeService: WorkshopIntakeService,
    private readonly catalogService: CatalogService,
    private readonly inventoryService: InventoryService,
    private readonly partsRequisitionService: PartsRequisitionService,
    private readonly writePipeline: McpWritePipelineService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

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
        return this.runTool(toolName, parsed);
      },
    );

    return capMcpToolPayload(record.workResult);
  }

  resolveAgentId(clientName: string | undefined): string {
    return formatMcpAgentId(clientName ?? 'unknown');
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
    await this.agentActionLog.record({
      actorType: 'AGENT',
      agentId: context.agentId,
      onBehalfOfUserId: context.onBehalfOfUserId,
      actionType: `mcp.${toolName}`,
      tier: 'PROPOSE',
      status: 'FAILED',
      inputSummary: { tool: toolName, args: rawArgs },
      resultSummary: {
        error: error instanceof Error ? error.message : 'Invalid input',
      },
    });
  }

  private buildWriteExecution(toolName: McpWriteToolName): McpWriteExecution {
    switch (toolName) {
      case 'draft_workshop_order':
        return {
          toolName,
          policyActionType: MCP_WRITE_POLICY_ACTION_TYPES.draft_workshop_order,
          buildPolicyContext: () => ({}),
          execute: (input) =>
            this.executeDraftWorkshopOrder(input as DraftWorkshopOrderInput),
          buildResultSummary: (result) => ({
            workshop_order_id: (result as { id: string }).id,
          }),
          buildLogMetadata: (result) => ({
            entityType: 'WorkshopOrder',
            entityId: (result as { id: string }).id,
            reversible: true,
          }),
        };
      case 'reserve_part':
        return {
          toolName,
          policyActionType: MCP_WRITE_POLICY_ACTION_TYPES.reserve_part,
          buildPolicyContext: (input) =>
            this.buildReservePartPolicyContext(input as ReservePartInput),
          execute: (input) =>
            this.executeReservePart(input as ReservePartInput),
          buildResultSummary: (result) => ({
            reservation_id: (result as { id: string }).id,
          }),
          buildLogMetadata: (result) => ({
            entityType: 'PartsReservation',
            entityId: (result as { id: string }).id,
            reversible: true,
          }),
        };
      case 'release_reservation':
        return {
          toolName,
          policyActionType: MCP_WRITE_POLICY_ACTION_TYPES.release_reservation,
          buildPolicyContext: (input) =>
            this.buildReleaseReservationPolicyContext(
              input as ReleaseReservationInput,
            ),
          execute: (input) =>
            this.executeReleaseReservation(input as ReleaseReservationInput),
          buildResultSummary: (result) => ({
            reservation_id: (result as { id: string }).id,
          }),
          buildLogMetadata: (result) => ({
            entityType: 'PartsReservation',
            entityId: (result as { id: string }).id,
            reversible: true,
          }),
        };
      case 'propose_line_item':
        return {
          toolName,
          policyActionType: MCP_WRITE_POLICY_ACTION_TYPES.propose_line_item,
          buildPolicyContext: (input) =>
            this.buildProposeLineItemPolicyContext(
              input as ProposeLineItemInput,
            ),
          execute: (input) =>
            this.executeProposeLineItem(input as ProposeLineItemInput),
          buildResultSummary: (result) => ({
            line_item_id: (result as { id: string }).id,
          }),
        };
    }
  }

  private async executeDraftWorkshopOrder(
    input: DraftWorkshopOrderInput,
  ): Promise<unknown> {
    return this.workshopIntakeService.create({
      customerId: input.customer_id,
      vehicleId: input.vehicle_id,
      purpose: input.purpose,
      status: input.status,
      bayId: input.bay_id,
      mechanicId: input.mechanic_id,
      scheduledStartAt: input.scheduled_start_at,
      scheduledEndAt: input.scheduled_end_at,
      odometer: input.odometer,
      fuelLevel: input.fuel_level,
      reportedIssue: input.reported_issue,
      notes: input.notes,
    });
  }

  private async buildReservePartPolicyContext(
    input: ReservePartInput,
  ): Promise<AgentPolicyEvaluateContext> {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const line = await this.prisma.workshopTaskLineItem.findFirst({
      where: {
        id: input.workshop_task_line_item_id,
        tenant_id: tenantId,
        workshop_task: { workshop_order: { site_id: siteId } },
      },
      select: { unit_price: true },
    });
    if (!line) {
      return {};
    }
    const amountCents = new Prisma.Decimal(input.quantity)
      .mul(line.unit_price)
      .mul(100)
      .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
      .toNumber();
    return { amount_eur: amountCents / 100 };
  }

  private async buildReleaseReservationPolicyContext(
    input: ReleaseReservationInput,
  ): Promise<AgentPolicyEvaluateContext> {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const reservation = await this.prisma.partsReservation.findFirst({
      where: {
        id: input.reservation_id,
        tenant_id: tenantId,
        workshop_task_line_item: {
          workshop_task: { workshop_order: { site_id: siteId } },
        },
      },
      select: {
        quantity: true,
        quantity_consumed: true,
        quantity_returned: true,
        workshop_task_line_item: { select: { unit_price: true } },
      },
    });
    if (!reservation) {
      return {};
    }

    const releasableQuantity = new Prisma.Decimal(reservation.quantity)
      .sub(reservation.quantity_consumed)
      .sub(reservation.quantity_returned);
    const amountCents = releasableQuantity.gt(0)
      ? releasableQuantity
          .mul(reservation.workshop_task_line_item.unit_price)
          .mul(100)
          .toDecimalPlaces(0, Prisma.Decimal.ROUND_HALF_UP)
          .toNumber()
      : 0;
    return { amount_eur: amountCents / 100 };
  }

  private async executeReservePart(input: ReservePartInput): Promise<unknown> {
    return this.partsRequisitionService.createOnHandReservation({
      workshopTaskLineItemId: input.workshop_task_line_item_id,
      quantity: input.quantity,
      locationId: input.location_id,
    });
  }

  private async executeReleaseReservation(
    input: ReleaseReservationInput,
  ): Promise<unknown> {
    return this.partsRequisitionService.releaseReservation(
      input.reservation_id,
      input.return_location_id !== undefined
        ? { returnLocationId: input.return_location_id }
        : {},
    );
  }

  private buildProposeLineItemPolicyContext(
    input: ProposeLineItemInput,
  ): AgentPolicyEvaluateContext {
    const amountCents = Math.round(
      input.line_item.quantity * input.line_item.unit_price_cents,
    );
    return { amount_eur: amountCents / 100 };
  }

  private async executeProposeLineItem(
    input: ProposeLineItemInput,
  ): Promise<unknown> {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const task = await this.prisma.workshopTask.findFirst({
      where: {
        id: input.workshop_task_id,
        tenant_id: tenantId,
        workshop_order_id: input.workshop_order_id,
        workshop_order: { tenant_id: tenantId, site_id: siteId },
      },
      select: { id: true, line_items_version: true },
    });
    if (!task) {
      throw new NotFoundException(
        'Workshop task not found for the active tenant',
      );
    }
    if (task.line_items_version !== input.expected_line_items_version) {
      throw new ConflictException(
        'Workshop task line items changed; please reload and retry',
      );
    }

    const created = await this.prisma.workshopTaskLineItem.create({
      data: {
        tenant_id: tenantId,
        workshop_task_id: task.id,
        type: input.line_item.type,
        part_execution_status:
          input.line_item.type === 'PART' ? 'PENDING_PICK' : null,
        item_no: input.line_item.item_no,
        description: input.line_item.description,
        quantity: new Prisma.Decimal(input.line_item.quantity),
        unit_price: new Prisma.Decimal(input.line_item.unit_price_cents / 100),
        labor_operation_id: input.line_item.labor_operation_id ?? null,
      },
      select: { id: true },
    });

    return { id: created.id };
  }

  private async runTool(
    toolName: McpReadToolName,
    parsed: unknown,
  ): Promise<unknown> {
    switch (toolName) {
      case 'search_customers':
        return this.searchCustomers(searchCustomersInputSchema.parse(parsed));
      case 'get_customer':
        return this.getCustomer(getCustomerInputSchema.parse(parsed));
      case 'search_vehicles':
        return this.searchVehicles(searchVehiclesInputSchema.parse(parsed));
      case 'get_vehicle':
        return this.getVehicle(getVehicleInputSchema.parse(parsed));
      case 'list_workshop_orders':
        return this.listWorkshopOrders(
          listWorkshopOrdersInputSchema.parse(parsed),
        );
      case 'get_workshop_order':
        return this.getWorkshopOrder(getWorkshopOrderInputSchema.parse(parsed));
      case 'search_parts':
        return this.searchParts(searchPartsInputSchema.parse(parsed));
      case 'get_stock_level':
        return this.getStockLevel(getStockLevelInputSchema.parse(parsed));
    }
  }

  private async searchCustomers(input: {
    search?: string;
    page?: number;
    page_size?: number;
  }) {
    const page = clampMcpPage(input.page);
    const pageSize = clampMcpPageSize(input.page_size);
    const skip = (page - 1) * pageSize;

    const { data, total } = await this.customerService.findAll({
      where: input.search
        ? {
            OR: [
              { first_name: { contains: input.search, mode: 'insensitive' } },
              { last_name: { contains: input.search, mode: 'insensitive' } },
              { company_name: { contains: input.search, mode: 'insensitive' } },
              { email: { contains: input.search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      skip,
      take: pageSize,
      orderBy: [{ company_name: 'asc' }, { last_name: 'asc' }],
    });

    return {
      data,
      meta: { total, page, page_size: pageSize },
    };
  }

  private async getCustomer(input: { customer_id: string }) {
    return this.customerService.findOne(input.customer_id, {
      historyPage: 1,
      historyLimit: 5,
    });
  }

  private async searchVehicles(input: {
    search?: string;
    page?: number;
    page_size?: number;
  }) {
    const page = clampMcpPage(input.page);
    const pageSize = clampMcpPageSize(input.page_size);
    return this.vehicleService.findAll({
      search: input.search,
      page,
      pageSize,
    });
  }

  private async getVehicle(input: { vehicle_id: string }) {
    return this.vehicleService.findOne(input.vehicle_id);
  }

  private async listWorkshopOrders(input: {
    search?: string;
    customer_id?: string;
    page?: number;
    page_size?: number;
  }) {
    const page = clampMcpPage(input.page);
    const pageSize = clampMcpPageSize(input.page_size);
    return this.workshopIntakeService.findAll({
      search: input.search,
      customerId: input.customer_id,
      page,
      pageSize,
    });
  }

  private async getWorkshopOrder(input: { workshop_order_id: string }) {
    return this.workshopIntakeService.findOne(input.workshop_order_id);
  }

  private async searchParts(input: {
    query: string;
    workshop_order_id?: string;
    page?: number;
    page_size?: number;
  }) {
    if (input.workshop_order_id) {
      const catalogResult = await this.catalogService.search(
        input.query,
        input.workshop_order_id,
      );
      return catalogResult;
    }

    const page = clampMcpPage(input.page);
    const pageSize = clampMcpPageSize(input.page_size);
    const inventoryResult = await this.inventoryService.findAll({
      search: input.query,
      page,
      pageSize,
    });
    return inventoryResult;
  }

  private async getStockLevel(input: {
    catalog_item_id?: string;
    sku?: string;
  }) {
    if (input.sku) {
      return this.inventoryService.checkAvailability(input.sku);
    }

    const tenantId = await this.tenantContext.getTenantId();
    const item = await this.prisma.catalogItem.findFirst({
      where: { id: input.catalog_item_id, tenant_id: tenantId },
      select: { id: true, sku: true },
    });
    if (!item) {
      throw new NotFoundException(
        `Catalog item with ID ${input.catalog_item_id} not found`,
      );
    }

    const availability = await this.inventoryService.checkAvailability(
      item.sku,
    );
    return {
      catalog_item_id: item.id,
      ...availability,
    };
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
