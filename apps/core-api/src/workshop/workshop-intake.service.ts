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
import {
  VEHICLE_IDENTITY_RESET,
  normalizeVehicleIdentityValue,
  normalizeVehicleIdentityValueOrNull,
  stripVehicleIdentityResolutionState,
} from '../vehicle/vehicle-identity.util';
import {
  buildCustomerSearchWhere,
  buildVehicleSearchWhere,
  buildWorkshopOrderFindAllWhere,
  buildWorkshopOrderOrderBy,
  LIVE_ORDER_STATUSES,
  ORDER_WITH_INVOICE_RELATIONS,
  ORDER_WITH_RELATIONS,
  pickClosestScheduledOrder,
  resolveFindAllPagination,
  SEARCH_LIMIT,
  validateCreateOrderInput,
  validateStockPrepVehicle,
} from './workshop-intake.helpers';

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

    const target = pickClosestScheduledOrder(scheduledOrders);
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

  private async computeCustomerId(
    tenantId: string,
    dto: RegisterIntakeDto,
  ): Promise<string> {
    if (dto.customerId) {
      const exists = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, tenant_id: tenantId },
      });
      if (!exists) {
        throw new NotFoundException(`Customer ${dto.customerId} not found`);
      }
      return dto.customerId;
    }

    if (dto.email) {
      const existingCustomer = await this.prisma.customer.findFirst({
        where: { tenant_id: tenantId, email: dto.email },
      });
      if (existingCustomer) {
        return existingCustomer.id;
      }
    }

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
    return customer.id;
  }

  private async updateExistingIntakeVehicle(
    tx: Prisma.TransactionClient,
    tenantId: string,
    existingVehicle: {
      id: string;
      plate: string | null;
      identity_resolution_generation: string | null;
      identity_resolution_token: string | null;
    },
    dto: RegisterIntakeDto,
    customerId: string,
    vin: string | null,
  ) {
    const identityChanged =
      normalizeVehicleIdentityValue(existingVehicle.plate) !==
      normalizeVehicleIdentityValue(dto.plate);
    const updated = await tx.vehicle.updateMany({
      where: {
        id: existingVehicle.id,
        tenant_id: tenantId,
        vin,
        plate: existingVehicle.plate,
        identity_resolution_generation:
          existingVehicle.identity_resolution_generation ?? null,
        identity_resolution_token:
          existingVehicle.identity_resolution_token ?? null,
      },
      data: {
        plate: dto.plate,
        customer_id: customerId,
        ...(identityChanged
          ? { ...VEHICLE_IDENTITY_RESET, identity_resolution_token: null }
          : {}),
      },
    });

    if (updated.count === 0) {
      throw new ConflictException(
        'Vehicle VIN or plate changed while registering intake; please retry',
      );
    }

    const vehicle = await tx.vehicle.findFirst({
      where: { id: existingVehicle.id, tenant_id: tenantId },
      include: { customer: true },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${existingVehicle.id} not found`);
    }
    return stripVehicleIdentityResolutionState(vehicle);
  }

  private async createNewIntakeVehicle(
    tx: Prisma.TransactionClient,
    tenantId: string,
    dto: RegisterIntakeDto,
    customerId: string,
    vin: string | null,
  ) {
    try {
      const vehicle = await tx.vehicle.create({
        data: {
          tenant_id: tenantId,
          vin,
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
      return stripVehicleIdentityResolutionState(vehicle);
    } catch (error: unknown) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        throw new ConflictException(
          'Vehicle was created by another intake; please retry',
        );
      }
      throw error;
    }
  }

  private async resolveIntakeVehicle(
    tx: Prisma.TransactionClient,
    tenantId: string,
    dto: RegisterIntakeDto,
    customerId: string,
  ) {
    const vin = normalizeVehicleIdentityValueOrNull(dto.vin);
    const existingVehicle =
      vin === null
        ? null
        : await tx.vehicle.findFirst({
            where: { tenant_id: tenantId, vin },
            select: {
              id: true,
              plate: true,
              identity_resolution_generation: true,
              identity_resolution_token: true,
            },
          });

    if (existingVehicle) {
      return this.updateExistingIntakeVehicle(
        tx,
        tenantId,
        existingVehicle,
        dto,
        customerId,
        vin,
      );
    }

    return this.createNewIntakeVehicle(tx, tenantId, dto, customerId, vin);
  }

  async register(dto: RegisterIntakeDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const customerId = await this.computeCustomerId(tenantId, dto);

    return this.prisma.$transaction(async (tx) => {
      return this.resolveIntakeVehicle(tx, tenantId, dto, customerId);
    });
  }

  private async validateCreatePrerequisites(
    tenantId: string,
    dto: CreateWorkshopOrderDto,
    purpose: WorkshopOrderPurpose,
  ) {
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: dto.vehicleId, tenant_id: tenantId },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${dto.vehicleId} not found`);
    }

    if (purpose === WorkshopOrderPurpose.CUSTOMER_REPAIR) {
      if (!dto.customerId) {
        throw new BadRequestException('customerId is required');
      }
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.customerId, tenant_id: tenantId },
      });
      if (!customer) {
        throw new NotFoundException(`Customer ${dto.customerId} not found`);
      }
    } else {
      validateStockPrepVehicle(vehicle);
    }

    return vehicle;
  }

  private async reserveStockPrepVehicle(
    tx: Prisma.TransactionClient,
    tenantId: string,
    vehicleId: string,
  ): Promise<void> {
    const flipped = await tx.vehicle.updateMany({
      where: {
        id: vehicleId,
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

  private async insertWorkshopOrder(
    tx: Prisma.TransactionClient,
    tenantId: string,
    dto: CreateWorkshopOrderDto,
    purpose: WorkshopOrderPurpose,
    booked: Awaited<
      ReturnType<WorkshopScheduleService['assertCanBook']>
    > | null,
  ): Promise<WorkshopOrderWithRelations> {
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
  }

  private async executeCreateOrder(
    tx: Prisma.TransactionClient,
    tenantId: string,
    dto: CreateWorkshopOrderDto,
    purpose: WorkshopOrderPurpose,
    vehicleId: string,
    isScheduled: boolean,
  ): Promise<WorkshopOrderWithRelations> {
    if (!isScheduled) {
      const promoted = await this.tryPromoteScheduledOrder(tx, tenantId, dto);
      if (promoted) {
        return promoted;
      }
    }
    await this.assertNoLiveOrderForVehicle(tx, tenantId, dto.vehicleId);

    if (purpose === WorkshopOrderPurpose.STOCK_PREP) {
      await this.reserveStockPrepVehicle(tx, tenantId, vehicleId);
    }

    const booked = isScheduled
      ? await this.scheduleService.assertCanBook(dto, undefined, tx)
      : null;

    return this.insertWorkshopOrder(tx, tenantId, dto, purpose, booked);
  }

  async create(dto: CreateWorkshopOrderDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const purpose = dto.purpose ?? WorkshopOrderPurpose.CUSTOMER_REPAIR;
    const isScheduled = dto.status === WorkshopOrderStatus.SCHEDULED;

    validateCreateOrderInput(dto, isScheduled);
    const vehicle = await this.validateCreatePrerequisites(
      tenantId,
      dto,
      purpose,
    );

    const order = await this.prisma.$transaction((tx) =>
      this.executeCreateOrder(
        tx,
        tenantId,
        dto,
        purpose,
        vehicle.id,
        isScheduled,
      ),
    );

    return normalizeWorkshopOrder(order);
  }

  async findAll(params: {
    search?: string;
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDirection?: 'asc' | 'desc';
  }) {
    const tenantId = await this.tenantContext.getTenantId();
    const { page, pageSize, skip } = resolveFindAllPagination(
      params.page,
      params.pageSize,
    );
    const where = buildWorkshopOrderFindAllWhere(tenantId, params.search);
    const orderBy = buildWorkshopOrderOrderBy(
      params.sortField,
      params.sortDirection,
    );

    const [data, total] = await Promise.all([
      this.prisma.workshopOrder.findMany({
        where,
        include: ORDER_WITH_RELATIONS,
        skip,
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
      include: ORDER_WITH_INVOICE_RELATIONS,
    });

    if (!order) {
      throw new NotFoundException(`Workshop order ${id} not found`);
    }

    return normalizeWorkshopOrder(order);
  }

  async updateOrder(id: string, dto: UpdateWorkshopOrderDto) {
    const existing = await this.findOne(id);
    assertOrderEditable(existing);

    const hasScheduleUpdate =
      dto.bayId !== undefined ||
      dto.scheduledStartAt !== undefined ||
      dto.scheduledEndAt !== undefined ||
      dto.mechanicId !== undefined;

    if (hasScheduleUpdate) {
      const updated = await this.prisma.$transaction(async (tx) => {
        const scheduleData = await this.scheduleService.rescheduleOrder(
          id,
          {
            vehicle_id: existing.vehicle_id,
            bay_id: existing.bay_id,
            mechanic_id: existing.mechanic_id,
            scheduled_start_at: existing.scheduled_start_at,
            scheduled_end_at: existing.scheduled_end_at,
            status: existing.status,
          },
          dto,
          tx,
        );

        return tx.workshopOrder.update({
          where: { id },
          data: {
            reported_issue: dto.reportedIssue,
            notes: dto.notes,
            bay_id: scheduleData.bayId,
            mechanic_id: scheduleData.mechanicId,
            scheduled_start_at: scheduleData.start,
            scheduled_end_at: scheduleData.end,
          },
          include: ORDER_WITH_INVOICE_RELATIONS,
        });
      });

      return normalizeWorkshopOrder(updated);
    }

    const updated = await this.prisma.workshopOrder.update({
      where: { id },
      data: {
        reported_issue: dto.reportedIssue,
        notes: dto.notes,
      },
      include: ORDER_WITH_INVOICE_RELATIONS,
    });

    return normalizeWorkshopOrder(updated);
  }

  async search(query: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const page = 1;
    const limit = SEARCH_LIMIT;
    const skip = (page - 1) * limit;

    const vehicleWhere = buildVehicleSearchWhere(tenantId, query);
    const customerWhere = buildCustomerSearchWhere(tenantId, query);

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
      data: {
        vehicles: vehicles.map(stripVehicleIdentityResolutionState),
        customers: customers.map((customer) => ({
          ...customer,
          vehicles: customer.vehicles?.map(stripVehicleIdentityResolutionState),
        })),
      },
      meta: {
        total,
        page,
        limit,
        totalPages: Math.ceil(total / limit),
      },
    };
  }
}
