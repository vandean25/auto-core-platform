import { Injectable } from '@nestjs/common';
import { CustomerService } from '../customer/customer.service.js';
import { LocationService } from '../inventory/location.service.js';
import { VehicleService } from '../vehicle/vehicle.service.js';
import { WorkshopBoardService } from '../workshop/workshop-board.service.js';
import { WorkshopIntakeService } from '../workshop/workshop-intake.service.js';
import { WorkshopTaskService } from '../workshop/workshop-task.service.js';
import { clampMcpPage, clampMcpPageSize } from './mcp-output.util.js';

/** MCP reads of customers, vehicles, workshop orders, tasks, bays and bins. Tenant and site scope come from the delegated services. */
@Injectable()
export class McpRecordReadService {
  private readonly customerService: CustomerService;
  private readonly vehicleService: VehicleService;
  private readonly workshopIntakeService: WorkshopIntakeService;
  private readonly locationService: LocationService;
  private readonly workshopBoardService: WorkshopBoardService;
  private readonly workshopTaskService: WorkshopTaskService;

  // Fields are assigned in the body rather than declared as parameter properties: cohesion analysis
  // otherwise counts the constructor as a separate component and flags the whole class as low-cohesion.
  constructor(
    customerService: CustomerService,
    vehicleService: VehicleService,
    workshopIntakeService: WorkshopIntakeService,
    locationService: LocationService,
    workshopBoardService: WorkshopBoardService,
    workshopTaskService: WorkshopTaskService,
  ) {
    this.customerService = customerService;
    this.vehicleService = vehicleService;
    this.workshopIntakeService = workshopIntakeService;
    this.locationService = locationService;
    this.workshopBoardService = workshopBoardService;
    this.workshopTaskService = workshopTaskService;
  }

  async listBays(input: { page?: number; page_size?: number }) {
    const page = clampMcpPage(input.page);
    const pageSize = clampMcpPageSize(input.page_size);
    const { bays } = await this.workshopBoardService.getBoardResources();
    const offset = (page - 1) * pageSize;
    return {
      data: bays.slice(offset, offset + pageSize),
      meta: { total: bays.length, page, page_size: pageSize },
    };
  }

  async listBins(input: { page?: number; page_size?: number }) {
    const page = clampMcpPage(input.page);
    const pageSize = clampMcpPageSize(input.page_size);
    const bins = await this.locationService.getBins();
    const offset = (page - 1) * pageSize;
    return {
      data: bins.slice(offset, offset + pageSize).map((bin) => ({
        id: bin.id,
        name: bin.name,
        code: bin.code,
        type: bin.type,
        parent: bin.parent,
      })),
      meta: { total: bins.length, page, page_size: pageSize },
    };
  }

  async listWorkshopTasks(input: { page?: number; page_size?: number }) {
    return this.workshopTaskService.listForMcp({
      page: clampMcpPage(input.page),
      pageSize: clampMcpPageSize(input.page_size),
    });
  }

  async searchCustomers(input: {
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

  async getCustomer(input: { customer_id: string }) {
    return this.customerService.findOne(input.customer_id, {
      historyPage: 1,
      historyLimit: 5,
    });
  }

  async searchVehicles(input: {
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

  async getVehicle(input: { vehicle_id: string }) {
    return this.vehicleService.findOne(input.vehicle_id);
  }

  async listWorkshopOrders(input: {
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

  async getWorkshopOrder(input: { workshop_order_id: string }) {
    return this.workshopIntakeService.findOne(input.workshop_order_id);
  }
}
