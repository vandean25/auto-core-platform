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
import { viennaIsoDay } from '../vehicle-stock/gewaehrleistung/gewaehrleistung-status.js';
import {
  activeOnDay,
  OPEN_DUE_DATE_LIMIT,
  OPEN_SERVICE_DUE,
} from './vehicle-party.query.js';
import { dayToDate } from './vehicle-party-date.util.js';
import {
  changeMainContactInTx,
  lockVehicleForPartyWrite,
} from './vehicle-party.writer.js';

export interface VehicleListQuery {
  where: Prisma.VehicleWhereInput;
  orderBy: Prisma.VehicleOrderByWithRelationInput;
  skip: number;
  take: number;
}

/** Customer fields shown next to a party. */
export const PARTY_CUSTOMER_SUMMARY = {
  select: {
    id: true,
    type: true,
    company_name: true,
    first_name: true,
    last_name: true,
  },
} as const;

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

  /**
   * Same guarded update, plus the OWNER hand-over for the new main contact, in one
   * transaction. Returns 0 (and writes nothing) when the identity guard is stale.
   */
  async updateIfIdentityUnchangedWithMainContact(input: {
    id: string;
    tenantId: string;
    existingVehicle: ExistingVehicleIdentity;
    data: Prisma.VehicleUncheckedUpdateManyInput;
    customerId: string | null;
    today: string;
  }): Promise<number> {
    const { id, tenantId, existingVehicle, data, customerId, today } = input;
    return this.prisma.$transaction(async (tx) => {
      // Lock first: the "customer unchanged" decision must see what the previous writer committed.
      await lockVehicleForPartyWrite(tx, tenantId, id);
      const current = await tx.vehicle.findFirst({
        where: { id, tenant_id: tenantId },
        select: { customer_id: true },
      });
      const { count } = await tx.vehicle.updateMany({
        where: buildVehicleIdentityGuard(id, tenantId, existingVehicle),
        data,
      });
      // Repeating the current customer is not a change: no party is invented or moved.
      if (count > 0 && current?.customer_id !== customerId) {
        await changeMainContactInTx(tx, { tenantId, today }, id, customerId);
      }
      return count;
    });
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
            source: true,
            external_inspection_result_id: true,
          },
        },
        parties: {
          where: {
            tenant_id: tenantId,
            ...activeOnDay(dayToDate(viennaIsoDay(new Date())) as Date),
          },
          orderBy: [{ role: 'asc' }, { id: 'asc' }],
          take: OPEN_DUE_DATE_LIMIT,
          include: { customer: PARTY_CUSTOMER_SUMMARY },
        },
        notices: {
          where: { tenant_id: tenantId, ...OPEN_SERVICE_DUE },
          orderBy: [{ due_date: 'asc' }, { id: 'asc' }],
          take: OPEN_DUE_DATE_LIMIT,
          select: {
            id: true,
            title: true,
            due_date: true,
            due_mileage: true,
            external_ref: true,
            source: true,
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
            source: true,
            external_inspection_result_id: true,
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
