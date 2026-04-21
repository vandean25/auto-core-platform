import {
  BadRequestException,
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto';
import type { PickWorkshopPartsDto } from './dto/pick-workshop-parts.dto';
import type { RegisterIntakeDto } from './dto/register-intake.dto';
import type { UpdateWorkshopOrderDto } from './dto/update-workshop-order.dto';
import type { CreateWorkshopTaskDto } from './dto/create-workshop-task.dto';
import type { UpdateWorkshopTaskDto } from './dto/update-workshop-task.dto';
import type { ReplaceWorkshopTaskLineItemsDto } from './dto/replace-workshop-task-line-items.dto';
import {
  Prisma,
  TransactionType,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { InvoicesService } from '../invoices/invoices.service';
import { LedgerService } from '../inventory/ledger.service';
import type { RecordTransactionParams } from '../inventory/ledger.service';
import { TenantContextService } from '../common/services/tenant-context.service';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const SEARCH_LIMIT = 100;
const PICK_ELIGIBLE_ORDER_STATUSES: WorkshopOrderStatus[] = [
  WorkshopOrderStatus.INTAKE,
  WorkshopOrderStatus.IN_PROGRESS,
];

type SourceAllocation = {
  sourceLocationId: string;
  quantity: number;
};

type AllocationReservationMap = Map<string, number>;

type WorkshopOrderWithTasks = Prisma.WorkshopOrderGetPayload<{
  include: {
    customer: true;
    vehicle: true;
    tasks: {
      include: {
        line_items: true;
      };
    };
  };
}>;

type WorkshopOrderWithRelations = WorkshopOrderWithTasks & {
  invoice?: { id: string; invoice_number: string | null } | null;
};

@Injectable()
export class WorkshopService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(InvoicesService) private invoicesService: InvoicesService,
    @Inject(LedgerService) private ledgerService: LedgerService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
  ) {}

  private async generateOrderNumber() {
    const tenantId = await this.tenantContext.getTenantId();
    const currentYear = new Date().getFullYear();
    const prefix = `WO-${currentYear}-`;

    const settings = await this.prisma.$transaction(async (tx) => {
      await tx.financeSettings.upsert({
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

      return tx.financeSettings.update({
        where: { tenant_id: tenantId },
        data: {
          next_workshop_order_number: { increment: 1 },
          workshop_order_prefix: prefix,
        },
        select: {
          next_workshop_order_number: true,
        },
      });
    });

    const paddedSequence = String(
      settings.next_workshop_order_number - 1,
    ).padStart(4, '0');
    return `${prefix}${paddedSequence}`;
  }

  private deriveOrderStatus(taskStatuses: WorkshopTaskStatus[]) {
    if (taskStatuses.length === 0) return WorkshopOrderStatus.INTAKE;
    if (taskStatuses.every((status) => status === WorkshopTaskStatus.DONE)) {
      return WorkshopOrderStatus.COMPLETED;
    }
    if (
      taskStatuses.every((status) => status === WorkshopTaskStatus.NOT_STARTED)
    ) {
      return WorkshopOrderStatus.INTAKE;
    }
    return WorkshopOrderStatus.IN_PROGRESS;
  }

  private assertOrderEditable(status: WorkshopOrderStatus) {
    if (status === WorkshopOrderStatus.INVOICED) {
      throw new BadRequestException('Workshop order is already invoiced');
    }
  }

  private assertPickEligible(status: WorkshopOrderStatus) {
    if (!PICK_ELIGIBLE_ORDER_STATUSES.includes(status)) {
      throw new UnprocessableEntityException(
        `Workshop order status ${status} is not eligible for pick execution`,
      );
    }
  }

  private getAllocationReservationKey(
    catalogItemId: string,
    sourceLocationId: string,
  ) {
    return `${catalogItemId}:${sourceLocationId}`;
  }

  private async allocateFromExplicitSource(
    tx: Prisma.TransactionClient,
    catalogItemId: string,
    sourceLocationId: string,
    quantity: number,
    reservations: AllocationReservationMap,
  ): Promise<SourceAllocation[]> {
    const tenantId = await this.tenantContext.getTenantId();
    const sourceLocation = await tx.storageLocation.findFirst({
      where: { id: sourceLocationId, tenant_id: tenantId },
      select: {
        id: true,
        type: true,
        deletedAt: true,
      },
    });

    if (!sourceLocation || sourceLocation.deletedAt) {
      throw new NotFoundException(
        `Source location ${sourceLocationId} not found`,
      );
    }

    if (sourceLocation.type !== 'bin') {
      throw new UnprocessableEntityException(
        `sourceLocationId must reference a BIN location. Received ${sourceLocation.type}.`,
      );
    }

    const sourceStock = await tx.inventoryStock.findFirst({
      where: {
        tenant_id: tenantId,
        catalog_item_id: catalogItemId,
        location_id: sourceLocationId,
      },
      select: {
        quantity_on_hand: true,
      },
    });

    const reservationKey = this.getAllocationReservationKey(
      catalogItemId,
      sourceLocationId,
    );
    const reservedQuantity = reservations.get(reservationKey) ?? 0;
    const available = (sourceStock?.quantity_on_hand ?? 0) - reservedQuantity;
    if (available < quantity) {
      throw new UnprocessableEntityException(
        `Insufficient stock in location ${sourceLocationId}. Requested ${quantity}, available ${Math.max(available, 0)}.`,
      );
    }

    return [{ sourceLocationId, quantity }];
  }

  private async allocateAcrossSources(
    tx: Prisma.TransactionClient,
    catalogItemId: string,
    quantity: number,
    reservations: AllocationReservationMap,
  ): Promise<SourceAllocation[]> {
    const tenantId = await this.tenantContext.getTenantId();
    const sourceStocks = await tx.inventoryStock.findMany({
      where: {
        tenant_id: tenantId,
        catalog_item_id: catalogItemId,
        quantity_on_hand: { gt: 0 },
        location: {
          type: 'bin',
          deletedAt: null,
        },
      },
      select: {
        location_id: true,
        quantity_on_hand: true,
        createdAt: true,
      },
      orderBy: [{ createdAt: 'asc' }, { location_id: 'asc' }],
    });

    let remaining = quantity;
    const allocations: SourceAllocation[] = [];

    for (const stock of sourceStocks) {
      if (remaining <= 0) {
        break;
      }

      const reservationKey = this.getAllocationReservationKey(
        catalogItemId,
        stock.location_id,
      );
      const reservedQuantity = reservations.get(reservationKey) ?? 0;
      const availableQuantity = stock.quantity_on_hand - reservedQuantity;

      if (availableQuantity <= 0) {
        continue;
      }

      const allocatedQuantity = Math.min(remaining, availableQuantity);
      if (allocatedQuantity <= 0) {
        continue;
      }

      allocations.push({
        sourceLocationId: stock.location_id,
        quantity: allocatedQuantity,
      });
      remaining -= allocatedQuantity;
    }

    if (remaining > 0) {
      throw new UnprocessableEntityException(
        `Insufficient stock for auto-allocation. Missing quantity ${remaining}.`,
      );
    }

    return allocations;
  }

  private normalizeWorkshopOrder(order: WorkshopOrderWithRelations) {
    return {
      ...order,
      tasks:
        order.tasks?.map((task) => ({
          ...task,
          done: task.status === WorkshopTaskStatus.DONE,
          lineItems:
            task.line_items?.map((line) => ({
              id: line.id,
              type: line.type,
              itemNo: line.item_no,
              description: line.description,
              qty: Number(line.quantity),
              unitPrice: Number(line.unit_price),
              laborOperationId: line.labor_operation_id,
              standardAw:
                line.standard_aw != null ? Number(line.standard_aw) : null,
              actualHours:
                line.actual_hours != null ? Number(line.actual_hours) : null,
              internalCostRate:
                line.internal_cost_rate != null
                  ? Number(line.internal_cost_rate)
                  : null,
            })) ?? [],
        })) ?? [],
    };
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
    const [customer, vehicle] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id: dto.customerId, tenant_id: tenantId },
      }),
      this.prisma.vehicle.findFirst({
        where: { id: dto.vehicleId, tenant_id: tenantId },
      }),
    ]);
    if (!customer)
      throw new NotFoundException(`Customer ${dto.customerId} not found`);
    if (!vehicle)
      throw new NotFoundException(`Vehicle ${dto.vehicleId} not found`);

    const orderNumber = await this.generateOrderNumber();

    const order = await this.prisma.workshopOrder.create({
      data: {
        tenant_id: tenantId,
        order_number: orderNumber,
        customer_id: dto.customerId,
        vehicle_id: dto.vehicleId,
        odometer: dto.odometer,
        fuel_level: dto.fuelLevel,
        reported_issue: dto.reportedIssue,
        notes: dto.notes,
        status: WorkshopOrderStatus.INTAKE,
      },
      include: {
        customer: true,
        vehicle: true,
        tasks: {
          include: {
            line_items: true,
          },
        },
      },
    });

    return this.normalizeWorkshopOrder(order as WorkshopOrderWithRelations);
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
        this.normalizeWorkshopOrder(order as WorkshopOrderWithRelations),
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

    return this.normalizeWorkshopOrder(order as WorkshopOrderWithRelations);
  }

  async updateOrder(id: string, dto: UpdateWorkshopOrderDto) {
    const existing = await this.findOne(id);
    this.assertOrderEditable(existing.status);

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

    return this.normalizeWorkshopOrder(updated as WorkshopOrderWithRelations);
  }

  async createTask(orderId: string, dto: CreateWorkshopTaskDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const createdTask = await this.prisma.$transaction(async (tx) => {
      const order = await tx.workshopOrder.findFirst({
        where: { id: orderId, tenant_id: tenantId },
        include: {
          tasks: true,
          invoice: { select: { id: true, invoice_number: true } },
        },
      });

      if (!order) {
        throw new NotFoundException(`Workshop order ${orderId} not found`);
      }
      this.assertOrderEditable(order.status);

      const task = await tx.workshopTask.create({
        data: {
          tenant_id: tenantId,
          workshop_order_id: orderId,
          title: dto.title,
          status: WorkshopTaskStatus.NOT_STARTED,
        },
        include: {
          line_items: true,
        },
      });

      const allTaskStatuses = [
        ...order.tasks.map((t) => t.status),
        task.status,
      ];
      const nextOrderStatus = this.deriveOrderStatus(allTaskStatuses);
      if (nextOrderStatus !== order.status) {
        const updateResult = await tx.workshopOrder.updateMany({
          where: {
            id: orderId,
            status: { not: WorkshopOrderStatus.INVOICED },
          },
          data: { status: nextOrderStatus },
        });
        if (updateResult.count === 0) {
          return {
            ...task,
            done: task.status === WorkshopTaskStatus.DONE,
            lineItems: [],
          };
        }
      }

      return {
        ...task,
        done: task.status === WorkshopTaskStatus.DONE,
        lineItems: [],
      };
    });

    return createdTask;
  }

  async updateTask(
    orderId: string,
    taskId: string,
    dto: UpdateWorkshopTaskDto,
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.workshopTask.findFirst({
        where: {
          id: taskId,
          tenant_id: tenantId,
          workshop_order_id: orderId,
        },
        include: {
          workshop_order: {
            select: {
              status: true,
              invoice: { select: { id: true, invoice_number: true } },
            },
          },
        },
      });

      if (!task) {
        throw new NotFoundException(`Task ${taskId} not found for this order`);
      }
      this.assertOrderEditable(task.workshop_order.status);

      await tx.workshopTask.update({
        where: { id: taskId },
        data: {
          title: dto.title,
          status: dto.status,
          mechanic_notes: dto.mechanicNotes,
        },
      });

      const tasks = await tx.workshopTask.findMany({
        where: { workshop_order_id: orderId, tenant_id: tenantId },
        select: { status: true },
      });

      const nextOrderStatus = this.deriveOrderStatus(
        tasks.map((t) => t.status),
      );
      const updateResult = await tx.workshopOrder.updateMany({
        where: {
          id: orderId,
          status: { not: WorkshopOrderStatus.INVOICED },
        },
        data: { status: nextOrderStatus },
      });
      if (updateResult.count === 0) {
        return;
      }
    });

    return this.findOne(orderId);
  }

  async deleteTask(orderId: string, taskId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.workshopTask.findFirst({
        where: {
          id: taskId,
          tenant_id: tenantId,
          workshop_order_id: orderId,
        },
        include: {
          workshop_order: {
            select: {
              status: true,
              invoice: { select: { id: true, invoice_number: true } },
            },
          },
        },
      });

      if (!task) {
        throw new NotFoundException(`Task ${taskId} not found for this order`);
      }
      this.assertOrderEditable(task.workshop_order.status);

      if (task.workshop_order.invoice) {
        throw new BadRequestException(
          'Workshop order already has an invoice; tasks cannot be deleted',
        );
      }

      const deleteResult = await tx.workshopTask.deleteMany({
        where: { id: taskId, tenant_id: tenantId },
      });

      if (deleteResult.count === 0) {
        throw new NotFoundException(`Task ${taskId} not found for this order`);
      }

      const tasks = await tx.workshopTask.findMany({
        where: { workshop_order_id: orderId, tenant_id: tenantId },
        select: { status: true },
      });

      const nextOrderStatus = this.deriveOrderStatus(
        tasks.map((existingTask) => existingTask.status),
      );
      await tx.workshopOrder.updateMany({
        where: {
          id: orderId,
          status: { not: WorkshopOrderStatus.INVOICED },
        },
        data: { status: nextOrderStatus },
      });
    });

    return this.findOne(orderId);
  }

  async replaceTaskLineItems(
    orderId: string,
    taskId: string,
    dto: ReplaceWorkshopTaskLineItemsDto,
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const task = await this.prisma.workshopTask.findFirst({
      where: {
        id: taskId,
        tenant_id: tenantId,
        workshop_order_id: orderId,
      },
      include: {
        workshop_order: {
          select: {
            status: true,
            invoice: { select: { id: true, invoice_number: true } },
          },
        },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found for this order`);
    }
    this.assertOrderEditable(task.workshop_order.status);

    // Validate labor operations belong to the current tenant
    const laborOperationIds = [
      ...new Set(
        dto.items
          .map((i) => i.laborOperationId)
          .filter((id): id is string => !!id),
      ),
    ];

    if (laborOperationIds.length > 0) {
      const foundCount = await this.prisma.laborOperation.count({
        where: {
          id: { in: laborOperationIds },
          tenant_id: tenantId,
        },
      });

      if (foundCount !== laborOperationIds.length) {
        throw new BadRequestException(
          'Invalid laborOperationId: one or more labor operations were not found within this tenant scope',
        );
      }
    }

    try {
      await this.prisma.$transaction(async (tx) => {
        await tx.workshopTaskLineItem.deleteMany({
          where: { workshop_task_id: taskId },
        });

        if (dto.items.length > 0) {
          await tx.workshopTaskLineItem.createMany({
            data: dto.items.map((item) => ({
              tenant_id: tenantId,
              workshop_task_id: taskId,
              type:
                item.type === WorkshopLineItemType.LABOR
                  ? WorkshopLineItemType.LABOR
                  : WorkshopLineItemType.PART,
              item_no: item.itemNo,
              description: item.description,
              quantity: new Prisma.Decimal(item.qty),
              unit_price: new Prisma.Decimal(item.unitPrice),
              labor_operation_id: item.laborOperationId ?? null,
              standard_aw:
                item.standardAw != null
                  ? new Prisma.Decimal(item.standardAw)
                  : null,
              actual_hours:
                item.actualHours != null
                  ? new Prisma.Decimal(item.actualHours)
                  : null,
              internal_cost_rate:
                item.internalCostRate != null
                  ? new Prisma.Decimal(item.internalCostRate)
                  : null,
            })),
          });
        }
      });
    } catch (error) {
      const fieldName =
        error instanceof Prisma.PrismaClientKnownRequestError
          ? error.meta?.field_name
          : undefined;
      const fieldNameText =
        typeof fieldName === 'string'
          ? fieldName
          : Array.isArray(fieldName)
            ? fieldName
                .filter((part): part is string => typeof part === 'string')
                .join(',')
            : '';

      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2003' &&
        fieldNameText.includes('labor_operation_id')
      ) {
        throw new BadRequestException(
          'Invalid laborOperationId: referenced labor operation was not found',
        );
      }
      throw error;
    }

    return this.findOne(orderId);
  }

  async pickParts(orderId: string, dto: PickWorkshopPartsDto) {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.workshopOrder.findFirst({
        where: { id: orderId, tenant_id: tenantId },
        select: {
          id: true,
          order_number: true,
          status: true,
          staging_location_id: true,
        },
      });

      if (!order) {
        throw new NotFoundException(`Workshop order ${orderId} not found`);
      }

      this.assertPickEligible(order.status);

      if (
        order.staging_location_id &&
        order.staging_location_id !== dto.destinationLocationId
      ) {
        throw new ConflictException(
          'Workshop order is already linked to a different staging location',
        );
      }

      const destinationLocation = await tx.storageLocation.findFirst({
        where: { id: dto.destinationLocationId, tenant_id: tenantId },
        select: {
          id: true,
          type: true,
          deletedAt: true,
        },
      });

      if (!destinationLocation || destinationLocation.deletedAt) {
        throw new NotFoundException(
          `Destination location ${dto.destinationLocationId} not found`,
        );
      }

      if (destinationLocation.type !== 'staging_tote') {
        throw new UnprocessableEntityException(
          'Destination location must be of type staging_tote',
        );
      }

      const aggregatedItems = new Map<
        string,
        {
          workshopTaskLineItemId: string;
          quantity: number;
          sourceLocationId?: string;
        }
      >();

      for (const requestItem of dto.items) {
        const existing = aggregatedItems.get(
          requestItem.workshopTaskLineItemId,
        );
        if (!existing) {
          aggregatedItems.set(requestItem.workshopTaskLineItemId, {
            workshopTaskLineItemId: requestItem.workshopTaskLineItemId,
            quantity: requestItem.quantity,
            sourceLocationId: requestItem.sourceLocationId,
          });
          continue;
        }

        const previousSource = existing.sourceLocationId ?? null;
        const incomingSource = requestItem.sourceLocationId ?? null;

        if (previousSource !== incomingSource) {
          throw new BadRequestException(
            `Duplicate line ${requestItem.workshopTaskLineItemId} must use a single sourceLocationId`,
          );
        }

        existing.quantity += requestItem.quantity;
      }

      const requestedLineItemIds = Array.from(aggregatedItems.keys());
      const lineItems = await tx.workshopTaskLineItem.findMany({
        where: {
          id: { in: requestedLineItemIds },
          type: WorkshopLineItemType.PART,
          workshop_task: {
            workshop_order_id: orderId,
          },
        },
        select: {
          id: true,
          item_no: true,
        },
      });

      if (lineItems.length !== requestedLineItemIds.length) {
        throw new NotFoundException(
          'One or more workshop part line items were not found for this order',
        );
      }

      const skus = Array.from(
        new Set(lineItems.map((lineItem) => lineItem.item_no)),
      );
      const catalogItems = await tx.catalogItem.findMany({
        where: {
          tenant_id: tenantId,
          sku: { in: skus },
        },
        select: {
          id: true,
          sku: true,
        },
      });

      if (catalogItems.length !== skus.length) {
        const catalogItemBySku = new Set(catalogItems.map((item) => item.sku));
        const missingSku = skus.find((sku) => !catalogItemBySku.has(sku));
        throw new NotFoundException(
          `Catalog item not found for workshop line SKU ${missingSku}`,
        );
      }

      const lineItemById = new Map(
        lineItems.map((lineItem) => [lineItem.id, lineItem]),
      );
      const catalogItemBySku = new Map(
        catalogItems.map((item) => [item.sku, item]),
      );
      const transferGroupId = `WO-PICK-${order.id}-${Date.now()}`;
      const ledgerTransactions: RecordTransactionParams[] = [];
      const reservations: AllocationReservationMap = new Map();
      const movedLines: Array<{
        workshopTaskLineItemId: string;
        movedQuantity: number;
        allocations: Array<{
          sourceLocationId: string;
          quantity: number;
          referenceId: string;
        }>;
      }> = [];

      for (const requestedItem of aggregatedItems.values()) {
        const lineItem = lineItemById.get(requestedItem.workshopTaskLineItemId);
        if (!lineItem) {
          throw new NotFoundException(
            `Line item ${requestedItem.workshopTaskLineItemId} not found`,
          );
        }

        const catalogItem = catalogItemBySku.get(lineItem.item_no);
        if (!catalogItem) {
          throw new NotFoundException(
            `Catalog item not found for workshop line SKU ${lineItem.item_no}`,
          );
        }

        const allocations = requestedItem.sourceLocationId
          ? await this.allocateFromExplicitSource(
              tx,
              catalogItem.id,
              requestedItem.sourceLocationId,
              requestedItem.quantity,
              reservations,
            )
          : await this.allocateAcrossSources(
              tx,
              catalogItem.id,
              requestedItem.quantity,
              reservations,
            );

        for (const allocation of allocations) {
          const reservationKey = this.getAllocationReservationKey(
            catalogItem.id,
            allocation.sourceLocationId,
          );
          reservations.set(
            reservationKey,
            (reservations.get(reservationKey) ?? 0) + allocation.quantity,
          );
        }

        const allocationSummaries: Array<{
          sourceLocationId: string;
          quantity: number;
          referenceId: string;
        }> = [];

        allocations.forEach((allocation, index) => {
          const referenceId = `${transferGroupId}:${lineItem.id}:${index + 1}`;
          ledgerTransactions.push(
            {
              itemId: catalogItem.id,
              locationId: allocation.sourceLocationId,
              quantity: -allocation.quantity,
              type: TransactionType.TRANSFER_OUT,
              referenceId,
            },
            {
              itemId: catalogItem.id,
              locationId: destinationLocation.id,
              quantity: allocation.quantity,
              type: TransactionType.TRANSFER_IN,
              referenceId,
            },
          );

          allocationSummaries.push({
            sourceLocationId: allocation.sourceLocationId,
            quantity: allocation.quantity,
            referenceId,
          });
        });

        movedLines.push({
          workshopTaskLineItemId: lineItem.id,
          movedQuantity: requestedItem.quantity,
          allocations: allocationSummaries,
        });
      }

      await this.ledgerService.recordTransactions(ledgerTransactions, tx);

      const orderUpdateResult = await tx.workshopOrder.updateMany({
        where: {
          id: orderId,
          status: {
            in: PICK_ELIGIBLE_ORDER_STATUSES,
          },
          OR: [
            { staging_location_id: null },
            { staging_location_id: dto.destinationLocationId },
          ],
        },
        data: {
          staging_location_id: dto.destinationLocationId,
        },
      });

      if (orderUpdateResult.count === 0) {
        throw new ConflictException(
          'Workshop order changed during pick execution. Refresh and retry.',
        );
      }

      return {
        id: order.id,
        stagingLocationId: dto.destinationLocationId,
        transferGroupId,
        movedLines,
      };
    });
  }

  async createInvoiceFromOrder(orderId: string) {
    return this.invoicesService.createDraftInvoice(orderId);
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
