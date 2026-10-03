import { Injectable, NotFoundException } from '@nestjs/common';
import { AgentActionLogService } from '../agent-action-log/agent-action-log.service.js';
import { CatalogService } from '../catalog/catalog.service.js';
import { CustomerService } from '../customer/customer.service.js';
import { InventoryService } from '../inventory/inventory.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { VehicleService } from '../vehicle/vehicle.service.js';
import { WorkshopIntakeService } from '../workshop/workshop-intake.service.js';
import type { McpReadToolName } from './mcp.constants.js';
import {
  capMcpToolPayload,
  clampMcpPage,
  clampMcpPageSize,
} from './mcp-output.util.js';
import {
  getCustomerInputSchema,
  getStockLevelInputSchema,
  getVehicleInputSchema,
  getWorkshopOrderInputSchema,
  listWorkshopOrdersInputSchema,
  mcpToolInputSchemas,
  searchCustomersInputSchema,
  searchPartsInputSchema,
  searchVehiclesInputSchema,
} from './mcp-tool-schemas.js';
import { formatMcpAgentId } from './mcp-agent-id.util.js';

export type McpToolCallContext = {
  agentId: string;
  onBehalfOfUserId: string;
};

@Injectable()
export class McpToolHandlerService {
  constructor(
    private readonly agentActionLog: AgentActionLogService,
    private readonly customerService: CustomerService,
    private readonly vehicleService: VehicleService,
    private readonly workshopIntakeService: WorkshopIntakeService,
    private readonly catalogService: CatalogService,
    private readonly inventoryService: InventoryService,
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async executeTool(
    toolName: McpReadToolName,
    rawArgs: unknown,
    context: McpToolCallContext,
  ): Promise<unknown> {
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
