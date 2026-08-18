import {
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import type { AssignBoardDto } from './dto/assign-board.dto';
import { PartsStatus } from './dto/board-response.dto';
import { PrismaService } from '../prisma/prisma.service';
import { WorkshopOrderStatus } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';

const ACTIVE_ORDER_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.SCHEDULED,
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

@Injectable()
export class WorkshopBoardService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
  ) {}

  async getBoardResources() {
    const tenantId = await this.tenantContext.getTenantId();

    const [mechanics, bays] = await Promise.all([
      this.prisma.employee.findMany({
        where: { tenant_id: tenantId, role: 'MECHANIC', is_active: true },
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        select: {
          id: true,
          name: true,
          role: true,
          is_active: true,
          sort_order: true,
        },
      }),
      this.prisma.bay.findMany({
        where: { tenant_id: tenantId, is_active: true },
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        select: { id: true, name: true, is_active: true, sort_order: true },
      }),
    ]);

    return {
      mechanics: mechanics.map((m) => ({
        id: m.id,
        name: m.name,
        role: m.role,
        isActive: m.is_active,
        sortOrder: m.sort_order,
      })),
      bays: bays.map((b) => ({
        id: b.id,
        name: b.name,
        isActive: b.is_active,
        sortOrder: b.sort_order,
      })),
    };
  }

  async getBoardActive() {
    const tenantId = await this.tenantContext.getTenantId();

    // Query 1: all active workshop orders with their tasks and line items
    const orders = await this.prisma.workshopOrder.findMany({
      where: { tenant_id: tenantId, status: { in: ACTIVE_ORDER_STATUSES } },
      include: {
        customer: true,
        vehicle: true,
        tasks: {
          include: {
            line_items: {
              include: {
                labor_operation: false,
              },
            },
          },
        },
      },
      orderBy: { createdAt: 'asc' },
    });

    // Collect all staging location IDs that have PART line items
    const stagingLocationIds = [
      ...new Set(
        orders
          .map((o) => o.staging_location_id)
          .filter((id): id is string => !!id),
      ),
    ];

    // Query 2: bulk-fetch inventory stock for all relevant staging locations
    const stockRecords =
      stagingLocationIds.length > 0
        ? await this.prisma.inventoryStock.findMany({
            where: {
              tenant_id: tenantId,
              location_id: { in: stagingLocationIds },
            },
            select: {
              location_id: true,
              catalog_item_id: true,
              quantity_on_hand: true,
            },
          })
        : [];

    // Build pre-fetched map: "locationId:catalogItemId" -> quantity
    const stockMap = new Map<string, number>();
    for (const record of stockRecords) {
      const key = `${record.location_id}:${record.catalog_item_id}`;
      stockMap.set(key, Number(record.quantity_on_hand));
    }

    // We also need catalog items to map SKU -> catalogItemId for line items
    const allSkus = [
      ...new Set(
        orders.flatMap((o) =>
          o.tasks.flatMap((t) =>
            t.line_items
              .filter((li) => li.type === 'PART')
              .map((li) => li.item_no),
          ),
        ),
      ),
    ];

    const catalogItems =
      allSkus.length > 0
        ? await this.prisma.catalogItem.findMany({
            where: { tenant_id: tenantId, sku: { in: allSkus } },
            select: { id: true, sku: true },
          })
        : [];

    const catalogIdBySku = new Map(catalogItems.map((c) => [c.sku, c.id]));

    // Compute partsStatus in-memory
    const data = orders.map((order) => {
      const partLineItems = order.tasks.flatMap((t) =>
        t.line_items.filter((li) => li.type === 'PART'),
      );

      let partsStatus: PartsStatus;
      if (partLineItems.length === 0) {
        partsStatus = PartsStatus.NO_PARTS;
      } else if (!order.staging_location_id) {
        partsStatus = PartsStatus.WAITING;
      } else {
        const hasShortage = partLineItems.some((li) => {
          const catalogItemId = catalogIdBySku.get(li.item_no);
          if (!catalogItemId) return true; // item missing → shortage
          const key = `${order.staging_location_id}:${catalogItemId}`;
          const qty = stockMap.get(key) ?? 0;
          return qty < Number(li.quantity);
        });
        partsStatus = hasShortage ? PartsStatus.SHORTAGE : PartsStatus.READY;
      }

      return {
        id: order.id,
        orderNumber: order.order_number,
        status: order.status,
        customer: order.customer
          ? {
              id: order.customer.id,
              type: order.customer.type,
              firstName: order.customer.first_name,
              lastName: order.customer.last_name,
              companyName: order.customer.company_name,
            }
          : null,
        vehicle: {
          id: order.vehicle.id,
          make: order.vehicle.make,
          model: order.vehicle.model,
          year: order.vehicle.year,
          plate: order.vehicle.plate,
        },
        mechanicId: order.mechanic_id,
        bayId: order.bay_id,
        stagingLocationId: order.staging_location_id,
        partsStatus,
        tasks: order.tasks.map((task) => ({
          id: task.id,
          title: task.title,
          status: task.status,
          lineItems: task.line_items.map((li) => ({
            id: li.id,
            type: li.type,
            itemNo: li.item_no,
            description: li.description,
            quantity: Number(li.quantity),
            unitPrice: Number(li.unit_price),
            partExecutionStatus: li.part_execution_status,
            catalogItemId: catalogIdBySku.get(li.item_no) ?? null,
          })),
        })),
        createdAt: order.createdAt,
        updatedAt: order.updatedAt,
      };
    });

    return { data };
  }

  async assignBoard(dto: AssignBoardDto) {
    const tenantId = await this.tenantContext.getTenantId();

    const order = await this.prisma.workshopOrder.findFirst({
      where: { id: dto.orderId, tenant_id: tenantId },
      select: { id: true, status: true },
    });

    if (!order) {
      throw new NotFoundException(`Workshop order ${dto.orderId} not found`);
    }

    if (!ACTIVE_ORDER_STATUSES.includes(order.status)) {
      throw new UnprocessableEntityException(
        `Cannot assign resources to an order in terminal status ${order.status}`,
      );
    }

    if (dto.mechanicId !== undefined && dto.mechanicId !== null) {
      const mechanic = await this.prisma.employee.findFirst({
        where: { id: dto.mechanicId, tenant_id: tenantId },
        select: { id: true, role: true, is_active: true },
      });

      if (!mechanic) {
        throw new NotFoundException(`Employee ${dto.mechanicId} not found`);
      }

      if (mechanic.role !== 'MECHANIC') {
        throw new UnprocessableEntityException(
          `Employee ${dto.mechanicId} is not a MECHANIC (role: ${mechanic.role})`,
        );
      }

      if (!mechanic.is_active) {
        throw new NotFoundException(`Employee ${dto.mechanicId} is inactive`);
      }
    }

    if (dto.bayId !== undefined && dto.bayId !== null) {
      const bay = await this.prisma.bay.findFirst({
        where: { id: dto.bayId, tenant_id: tenantId },
        select: { id: true, is_active: true },
      });

      if (!bay) {
        throw new NotFoundException(`Bay ${dto.bayId} not found`);
      }

      if (!bay.is_active) {
        throw new NotFoundException(`Bay ${dto.bayId} is inactive`);
      }
    }

    // Single-row update — last-write-wins (per ADR-0013)
    const updated = await this.prisma.workshopOrder.update({
      where: {
        tenant_id_id: {
          tenant_id: tenantId,
          id: dto.orderId,
        },
      },
      data: {
        ...(dto.mechanicId !== undefined && { mechanic_id: dto.mechanicId }),
        ...(dto.bayId !== undefined && { bay_id: dto.bayId }),
      },
      select: {
        id: true,
        order_number: true,
        status: true,
        mechanic_id: true,
        bay_id: true,
        staging_location_id: true,
        updatedAt: true,
      },
    });

    return {
      id: updated.id,
      orderNumber: updated.order_number,
      status: updated.status,
      mechanicId: updated.mechanic_id,
      bayId: updated.bay_id,
      stagingLocationId: updated.staging_location_id,
      updatedAt: updated.updatedAt,
    };
  }
}
