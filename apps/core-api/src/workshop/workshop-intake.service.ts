import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto';
import type { RegisterIntakeDto } from './dto/register-intake.dto';
import type { UpdateWorkshopOrderDto } from './dto/update-workshop-order.dto';
import {
  Prisma,
  VehicleInventoryRole,
  VehicleStockStatus,
  WorkshopOrderPurpose,
  WorkshopOrderStatus,
} from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import {
  normalizeWorkshopOrder,
  assertOrderEditable,
  type WorkshopOrderWithRelations,
} from './workshop-order.helpers';
import { WorkshopScheduleService } from './workshop-schedule.service';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const SEARCH_LIMIT = 100;

const LIVE_ORDER_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.SCHEDULED,
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

const ORDER_WITH_RELATIONS = {
  customer: true,
  vehicle: true,
  tasks: {
    include: {
      line_items: true,
    },
  },
} as const;

@Injectable()
export class WorkshopIntakeService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
    private readonly scheduleService: WorkshopScheduleService,
  ) {}

  private async generateOrderNumber(tx?: Prisma.TransactionClient) {
    const tenantId = await this.tenantContext.getTenantId();
    const currentYear = new Date().getFullYear();
    const prefix = `WO-${currentYear}-`;
    const db = tx ?? this.prisma;

    const settings = await (async () => {
      await db.financeSettings.upsert({
        where: { tenant_id: tenantId },
        update: {},
        create: {
          tenant_id: tenantId,
          fiscal_year_start_month: 1,
          lock_date: null,
          next_invoice_number: 1001,
          invoice_prefix: 'RE-2026-',
          next_sales_order_number: 1001,
          sales_order_prefix: 'SO-2026-',
          next_workshop_order_number: 1,
          workshop_order_prefix: prefix,
        },
      });

      return db.financeSettings.update({
        where: { tenant_id: tenantId },
        data: {
          next_workshop_order_number: { increment: 1 },
          workshop_order_prefix: prefix,
        },
        select: {
          next_workshop_order_number: true,
        },
      });
    })();

    const paddedSequence = String(
      settings.next_workshop_order_number - 1,
    ).padStart(4, '0');
    return `${prefix}${paddedSequence}`;
  }

  private async findLiveOrderForVehicle(
    tx: Prisma.TransactionClient,
    tenantId: string,
    vehicleId: string,
  ) {
    return tx.workshopOrder.findFirst({
      where: {
        tenant_id: tenantId,
        vehicle_id: vehicleId,
        status: { in: LIVE_ORDER_STATUSES },
      },
      select: { id: true, order_number: true },
    });
  }

  private async assertNoLiveOrderForVehicle(
    tx: Prisma.TransactionClient,
    tenantId: string,
    vehicleId: string,
  ): Promise<void> {
    const live = await this.findLiveOrderForVehicle(tx, tenantId, vehicleId);
    if (live) {
      throw new ConflictException(
        `Vehicle already has active order ${live.order_number}`,
      );
    }
  }

  private pickClosestScheduledOrder<
    T extends { id: string; scheduled_start_at: Date | null },
  >(orders: T[]): T {
    const now = Date.now();
    return [...orders].sort((left, right) => {
      const leftStart = left.scheduled_start_at?.getTime();
      const rightStart = right.scheduled_start_at?.getTime();
      if (leftStart == null && rightStart == null) return 0;
      if (leftStart == null) return 1;
      if (rightStart == null) return -1;
      return (
        Math.abs(leftStart - now) - Math.abs(rightStart - now) ||
        leftStart - rightStart
      );
    })[0];
  }

  private async tryPromoteScheduledOrder(
    tx: Prisma.TransactionClient,
    tenantId: string,
    dto: CreateWorkshopOrderDto,
  ): Promise<WorkshopOrderWithRelations | null> {
    const scheduledOrders = await tx.workshopOrder.findMany({
      where: {
        tenant_id: tenantId,
        vehicle_id: dto.vehicleId,
        status: WorkshopOrderStatus.SCHEDULED,
      },
      select: {
        id: true,
        scheduled_start_at: true,
      },
    });
    if (scheduledOrders.length === 0) {
      return null;
    }

    const target = this.pickClosestScheduledOrder(scheduledOrders);
    const promoted = await tx.workshopOrder.updateMany({
      where: {
        id: target.id,
        tenant_id: tenantId,
        status: WorkshopOrderStatus.SCHEDULED,
      },
      data: {
        status: WorkshopOrderStatus.INTAKE,
        odometer: dto.odometer ?? 0,
        fuel_level: dto.fuelLevel ?? 0,
        reported_issue: dto.reportedIssue,
        notes: dto.notes,
      },
    });

    if (promoted.count === 0) {
      const live = await this.findLiveOrderForVehicle(
        tx,
        tenantId,
        dto.vehicleId,
      );
      if (live) {
        throw new ConflictException(
          `Vehicle already has active order ${live.order_number}`,
        );
      }
      return null;
    }

    const order = await tx.workshopOrder.findFirst({
      where: { id: target.id, tenant_id: tenantId },
      include: ORDER_WITH_RELATIONS,
    });
    if (!order) {
      throw new NotFoundException(
        `Workshop order ${target.id} not found after promote`,
      );
    }
    return order;
  }

  async register(dto: RegisterIntakeDto) {
    const tenantId = await this.tenantContext.getTenantId();
    let customerId = dto.customerId;

    if (!customerId) {
      const existingCustomer = dto.email
        ? await this.prisma.customer.findFirst({
            where: { tenant_id: tenantId, email: dto.email },
          })
        : null;

      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
        const customer = await this.prisma.customer.create({
          data: {
            tenant_id: tenantId,
            first_name: dto.firstName || '',
            last_name: dto.lastName || '',
            email: dto.email,
            phone: dto.phone,
            type: 'PRIVATE',
          },
        });
        customerId = customer.id;
      }
    } else {
      const exists = await this.prisma.customer.findFirst({
        where: { id: customerId, tenant_id: tenantId },
      });
      if (!exists)
        throw new NotFoundException(`Customer ${customerId} not found`);
    }

    const vehicle = await this.prisma.vehicle.upsert({
      where: { tenant_id_vin: { tenant_id: tenantId, vin: dto.vin } },
      update: {
        plate: dto.plate,
        customer_id: customerId,
      },
      create: {
        tenant_id: tenantId,
        vin: dto.vin,
        plate: dto.plate,
        make: dto.make,
        model: dto.model,
        year: dto.year,
        customer_id: customerId,
      },
      include: {
        customer: true,
      },
    });

    return vehicle;
  }

  async create(dto: CreateWorkshopOrderDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const purpose = dto.purpose ?? WorkshopOrderPurpose.CUSTOMER_REPAIR;
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: dto.vehicleId, tenant_id: tenantId },
    });
    if (!vehicle)
      throw new NotFoundException(`Vehicle ${dto.vehicleId} not found`);

    if (purpose === WorkshopOrderPurpose.CUSTOMER_REPAIR) {
      if (!dto.customerId) {
        throw new BadRequestException('customerId is required');
      }
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, tenant_id: tenantId },
      });
      if (!customer)
        throw new NotFoundException(`Customer ${dto.customerId} not found`);
    } else {
      if (vehicle.inventory_role !== VehicleInventoryRole.USED) {
        throw new BadRequestException(
          'Stock prep requires a used dealer-stock vehicle',
        );
      }
      if (
        vehicle.stock_status !== VehicleStockStatus.IN_STOCK &&
        vehicle.stock_status !== VehicleStockStatus.RESERVED
      ) {
        throw new BadRequestException(
          'Stock prep requires the vehicle to be in stock',
        );
      }
    }

    const isScheduled = dto.status === WorkshopOrderStatus.SCHEDULED;
    if (
      !isScheduled &&
      (dto.odometer === undefined || dto.fuelLevel === undefined)
    ) {
      throw new BadRequestException('odometer and fuelLevel are required');
    }

    const order = await this.prisma.$transaction(async (tx) => {
      if (!isScheduled) {
        const promoted = await this.tryPromoteScheduledOrder(
          tx,
          tenantId,
          dto,
        );
        if (promoted) {
          return promoted;
        }
        await this.assertNoLiveOrderForVehicle(tx, tenantId, dto.vehicleId);
      } else {
        await this.assertNoLiveOrderForVehicle(tx, tenantId, dto.vehicleId);
      }

      if (purpose === WorkshopOrderPurpose.STOCK_PREP) {
        const flipped = await tx.vehicle.updateMany({
          where: {
            id: vehicle.id,
            tenant_id: tenantId,
            stock_status: {
              in: [VehicleStockStatus.IN_STOCK, VehicleStockStatus.RESERVED],
            },
          },
          data: { stock_status: VehicleStockStatus.IN_PREP },
        });
        if (flipped.count === 0) {
          throw new ConflictException(
            'Vehicle is no longer available for stock prep',
          );
        }
      }

      const booked = isScheduled
        ? await this.scheduleService.assertCanBook(dto, undefined, tx)
        : null;

      const orderNumber = await this.generateOrderNumber(tx);
      return tx.workshopOrder.create({
        data: {
          tenant_id: tenantId,
          order_number: orderNumber,
          purpose,
          customer_id:
            purpose === WorkshopOrderPurpose.CUSTOMER_REPAIR
              ? dto.customerId
              : null,
          vehicle_id: dto.vehicleId,
          odometer: dto.odometer ?? 0,
          fuel_level: dto.fuelLevel ?? 0,
          reported_issue: dto.reportedIssue,
          notes: dto.notes,
          status: booked
            ? WorkshopOrderStatus.SCHEDULED
            : WorkshopOrderStatus.INTAKE,
          bay_id: booked?.bayId,
          mechanic_id: booked?.mechanicId,
          scheduled_start_at: booked?.start,
          scheduled_end_at: booked?.end,
        },
        include: ORDER_WITH_RELATIONS,
      });
    });

    return normalizeWorkshopOrder(order as WorkshopOrderWithRelations);
  }

  async findAll(params: {
    search?: string;
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDirection?: 'asc' | 'desc';
  }) {
    const tenantId = await this.tenantContext.getTenantId();
    const page = params.page && params.page > 0 ? params.page : 1;
    const resolvedPageSize =
      params.pageSize && params.pageSize > 0
        ? params.pageSize
        : DEFAULT_PAGE_SIZE;
    const pageSize = Math.min(resolvedPageSize, MAX_PAGE_SIZE);

    const where: Prisma.WorkshopOrderWhereInput = params.search
      ? {
          tenant_id: tenantId,
          OR: [
            {
              order_number: { contains: params.search, mode: 'insensitive' },
            },
            { id: { contains: params.search, mode: 'insensitive' } },
            {
              customer: {
                OR: [
                  {
                    first_name: {
                      contains: params.search,
                      mode: 'insensitive',
                    },
                  },
                  {
                    last_name: { contains: params.search, mode: 'insensitive' },
                  },
                  {
                    company_name: {
                      contains: params.search,
                      mode: 'insensitive',
                    },
                  },
                ],
              },
            },
            {
              vehicle: {
                OR: [
                  { make: { contains: params.search, mode: 'insensitive' } },
                  { model: { contains: params.search, mode: 'insensitive' } },
                  { plate: { contains: params.search, mode: 'insensitive' } },
                  { vin: { contains: params.search, mode: 'insensitive' } },
                ],
              },
            },
          ],
        }
      : { tenant_id: tenantId };

    const sortField = params.sortField ?? 'createdAt';
    const sortDirection = params.sortDirection ?? 'desc';

    let orderBy: Prisma.WorkshopOrderOrderByWithRelationInput = {
      createdAt: sortDirection,
    };

    if (sortField === 'status') {
      orderBy = { status: sortDirection };
    } else if (sortField === 'orderNo' || sortField === 'order_number') {
      orderBy = { order_number: sortDirection };
    } else if (sortField === 'id') {
      orderBy = { id: sortDirection };
    } else if (sortField === 'customer') {
      orderBy = { customer: { last_name: sortDirection } };
    } else if (sortField === 'vehicle') {
      orderBy = { vehicle: { make: sortDirection } };
    }

    const [data, total] = await Promise.all([
      this.prisma.workshopOrder.findMany({
        where,
        include: {
          customer: true,
          vehicle: true,
          tasks: {
            include: {
              line_items: true,
            },
          },
        },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy,
      }),
      this.prisma.workshopOrder.count({ where }),
    ]);

    return {
      data: data.map((order) =>
        normalizeWorkshopOrder(order as WorkshopOrderWithRelations),
      ),
      meta: {
        total,
        page,
        pageSize,
        pageCount: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const order = await this.prisma.workshopOrder.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        customer: true,
        vehicle: true,
        invoice: { select: { id: true, invoice_number: true } },
        tasks: {
          orderBy: { createdAt: 'asc' },
          include: {
            line_items: true,
          },
        },
      },
    });

    if (!order) {
      throw new NotFoundException(`Workshop order ${id} not found`);
    }

    return normalizeWorkshopOrder(order);
  }

  async updateOrder(id: string, dto: UpdateWorkshopOrderDto) {
    const existing = await this.findOne(id);
    assertOrderEditable(existing);

    const updated = await this.prisma.workshopOrder.update({
      where: { id },
      data: {
        reported_issue: dto.reportedIssue,
        notes: dto.notes,
      },
      include: {
        customer: true,
        vehicle: true,
        invoice: { select: { id: true, invoice_number: true } },
        tasks: {
          orderBy: { createdAt: 'asc' },
          include: {
            line_items: true,
          },
        },
      },
    });

    return normalizeWorkshopOrder(updated);
  }

  async search(query: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        query,
      );

    const page = 1;
    const limit = SEARCH_LIMIT;
    const skip = (page - 1) * limit;

    const vehicleWhere: Prisma.VehicleWhereInput = {
      tenant_id: tenantId,
      OR: [
        { vin: { contains: query, mode: 'insensitive' } },
        { plate: { contains: query, mode: 'insensitive' } },
      ],
    };

    const customerWhere: Prisma.CustomerWhereInput = {
      tenant_id: tenantId,
      OR: [
        ...(isUuid ? [{ id: { equals: query } }] : []),
        { first_name: { contains: query, mode: 'insensitive' } },
        { last_name: { contains: query, mode: 'insensitive' } },
        { company_name: { contains: query, mode: 'insensitive' } },
        { phone: { contains: query, mode: 'insensitive' } },
      ],
    };

    const [vehicles, customers, vehicleTotal, customerTotal] =
      await Promise.all([
        this.prisma.vehicle.findMany({
          where: vehicleWhere,
          include: {
            customer: true,
          },
          skip,
          take: limit,
        }),
        this.prisma.customer.findMany({
          where: customerWhere,
          include: {
            vehicles: true,
          },
          skip,
          take: limit,
        }),
        this.prisma.vehicle.count({ where: vehicleWhere }),
        this.prisma.customer.count({ where: customerWhere }),
      ]);

    const total = vehicleTotal + customerTotal;

    return {
      data: { vehicles, customers },
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
