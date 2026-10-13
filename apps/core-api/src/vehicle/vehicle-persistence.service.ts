import { Inject, Injectable } from '@nestjs/common';
import { Prisma, WorkshopOrderStatus } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import {
  invoicesHistorySlice,
  salesOrdersHistorySlice,
  workshopOrdersHistorySlice,
} from '../common/queries/entity-history.query.js';
import { DEFAULT_HISTORY_LIMIT } from '../common/utils/history-pagination.util.js';
import { PICKERL_TASK_TITLE } from '../workshop/workshop-pickerl.helpers.js';
import type { ExistingVehicleIdentity } from './vehicle-write.mapper.js';
import { buildVehicleIdentityGuard } from './vehicle-write.mapper.js';

export interface VehicleListQuery {
  where: Prisma.VehicleWhereInput;
  orderBy: Prisma.VehicleOrderByWithRelationInput;
  skip: number;
  take: number;
}

const OPEN_PICKERL_ORDER_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.SCHEDULED,
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

@Injectable()
export class VehiclePersistenceService {
  constructor(@Inject(PrismaService) private readonly prisma: PrismaService) {}

  async findIdentityForUpdate(
    id: string,
    tenantId: string,
  ): Promise<ExistingVehicleIdentity | null> {
    return this.prisma.vehicle.findFirst({
      where: { id, tenant_id: tenantId },
      select: {
        id: true,
        vin: true,
        plate: true,
        identity_resolution_generation: true,
        identity_resolution_token: true,
      },
    });
  }

  async customerExists(customerId: string, tenantId: string): Promise<boolean> {
    const customer = await this.prisma.customer.findFirst({
      where: { id: customerId, tenant_id: tenantId },
      select: { id: true },
    });
    return Boolean(customer);
  }

  async createVehicle(data: Prisma.VehicleUncheckedCreateInput) {
    return this.prisma.vehicle.create({
      data,
      include: { customer: true },
    });
  }

  /** Returns the number of rows matched by the identity guard (0 when stale). */
  async updateIfIdentityUnchanged(
    id: string,
    tenantId: string,
    existingVehicle: ExistingVehicleIdentity,
    data: Prisma.VehicleUncheckedUpdateManyInput,
  ): Promise<number> {
    const { count } = await this.prisma.vehicle.updateMany({
      where: buildVehicleIdentityGuard(id, tenantId, existingVehicle),
      data,
    });
    return count;
  }

  async vehicleExists(id: string, tenantId: string): Promise<boolean> {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, tenant_id: tenantId },
      select: { id: true },
    });
    return Boolean(vehicle);
  }

  async findVehicleWithCustomer(id: string, tenantId: string) {
    return this.prisma.vehicle.findFirst({
      where: { id, tenant_id: tenantId },
      include: { customer: true },
    });
  }

  async findVehicleDetail(
    id: string,
    tenantId: string,
    authorizedSiteIds: string[],
  ) {
    const historySlice = { take: DEFAULT_HISTORY_LIMIT };
    return this.prisma.vehicle.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        customer: true,
        location: true,
        reserved_for_customer: true,
        sales_orders: {
          ...salesOrdersHistorySlice(historySlice),
          where: { site_id: { in: authorizedSiteIds } },
        },
        workshop_orders: {
          ...workshopOrdersHistorySlice('vehicle-detail', historySlice),
          where: { site_id: { in: authorizedSiteIds } },
        },
        purchases: {
          where: { site_id: { in: authorizedSiteIds } },
          orderBy: { createdAt: 'desc' },
        },
        sales: {
          where: { site_id: { in: authorizedSiteIds } },
          orderBy: { createdAt: 'desc' },
        },
        invoices: invoicesHistorySlice(historySlice),
        inspection_records: {
          orderBy: { inspected_on: 'desc' },
          select: {
            inspected_on: true,
            plaketten_valid_until_year: true,
            plaketten_valid_until_month: true,
          },
        },
      },
    });
  }

  async listVehicles(query: VehicleListQuery) {
    const { where, orderBy, skip, take } = query;
    const [rows, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        include: {
          customer: true,
          location: true,
          reserved_for_customer: true,
        },
        skip,
        take,
        orderBy,
      }),
      this.prisma.vehicle.count({ where }),
    ]);
    return { rows, total };
  }

  async findPickerlCandidates(where: Prisma.VehicleWhereInput) {
    return this.prisma.vehicle.findMany({
      where,
      include: {
        customer: true,
        inspection_records: {
          orderBy: { inspected_on: 'desc' },
          select: {
            inspected_on: true,
            plaketten_valid_until_year: true,
            plaketten_valid_until_month: true,
          },
        },
      },
    });
  }

  async findOpenPickerlOrders(
    tenantId: string,
    siteId: string,
    vehicleIds: string[],
  ) {
    return this.prisma.workshopOrder.findMany({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        vehicle_id: { in: vehicleIds },
        status: { in: OPEN_PICKERL_ORDER_STATUSES },
        tasks: { some: { title: PICKERL_TASK_TITLE } },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, order_number: true, vehicle_id: true },
    });
  }

  async findOpenPickerlOrder(
    vehicleId: string,
    tenantId: string,
    siteId: string,
  ) {
    return this.prisma.workshopOrder.findFirst({
      where: {
        tenant_id: tenantId,
        site_id: siteId,
        vehicle_id: vehicleId,
        status: { in: OPEN_PICKERL_ORDER_STATUSES },
        tasks: { some: { title: PICKERL_TASK_TITLE } },
      },
      orderBy: { createdAt: 'desc' },
      select: { id: true, order_number: true },
    });
  }
}
