import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import type { CreateWorkshopOrderDto } from './dto/create-workshop-order.dto';
import type { RegisterIntakeDto } from './dto/register-intake.dto';
import type { UpdateWorkshopOrderDto } from './dto/update-workshop-order.dto';
import type { CreateWorkshopTaskDto } from './dto/create-workshop-task.dto';
import type { UpdateWorkshopTaskDto } from './dto/update-workshop-task.dto';
import type { ReplaceWorkshopTaskLineItemsDto } from './dto/replace-workshop-task-line-items.dto';
import {
  Prisma,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { InvoicesService } from '../invoices/invoices.service';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const SEARCH_LIMIT = 100;

@Injectable()
export class WorkshopService {
  constructor(
    private prisma: PrismaService,
    private invoicesService: InvoicesService,
  ) {}

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

  private normalizeWorkshopOrder(order: any) {
    return {
      ...order,
      tasks:
        order.tasks?.map((task: any) => ({
          ...task,
          done: task.status === WorkshopTaskStatus.DONE,
          lineItems:
            task.line_items?.map((line: any) => ({
              id: line.id,
              type: line.type,
              itemNo: line.item_no,
              description: line.description,
              qty: Number(line.quantity),
              unitPrice: Number(line.unit_price),
            })) ?? [],
        })) ?? [],
    };
  }

  async register(dto: RegisterIntakeDto) {
    let customerId = dto.customerId;

    if (!customerId) {
      const existingCustomer = dto.email
        ? await this.prisma.customer.findUnique({ where: { email: dto.email } })
        : null;

      if (existingCustomer) {
        customerId = existingCustomer.id;
      } else {
        const customer = await this.prisma.customer.create({
          data: {
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
      const exists = await this.prisma.customer.findUnique({
        where: { id: customerId },
      });
      if (!exists)
        throw new NotFoundException(`Customer ${customerId} not found`);
    }

    const vehicle = await this.prisma.vehicle.upsert({
      where: { vin: dto.vin },
      update: {
        plate: dto.plate,
        customer_id: customerId,
      },
      create: {
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
    const [customer, vehicle] = await Promise.all([
      this.prisma.customer.findUnique({ where: { id: dto.customerId } }),
      this.prisma.vehicle.findUnique({ where: { id: dto.vehicleId } }),
    ]);
    if (!customer)
      throw new NotFoundException(`Customer ${dto.customerId} not found`);
    if (!vehicle)
      throw new NotFoundException(`Vehicle ${dto.vehicleId} not found`);

    const order = await this.prisma.workshopOrder.create({
      data: {
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

    return this.normalizeWorkshopOrder(order);
  }

  async findAll(params: {
    search?: string;
    page?: number;
    pageSize?: number;
    sortField?: string;
    sortDirection?: 'asc' | 'desc';
  }) {
    const page = params.page && params.page > 0 ? params.page : 1;
    const resolvedPageSize =
      params.pageSize && params.pageSize > 0
        ? params.pageSize
        : DEFAULT_PAGE_SIZE;
    const pageSize = Math.min(resolvedPageSize, MAX_PAGE_SIZE);

    const where: Prisma.WorkshopOrderWhereInput = params.search
      ? {
          OR: [
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
      : {};

    const sortField = params.sortField ?? 'createdAt';
    const sortDirection = params.sortDirection ?? 'desc';

    let orderBy: Prisma.WorkshopOrderOrderByWithRelationInput = {
      createdAt: sortDirection,
    };

    if (sortField === 'status') {
      orderBy = { status: sortDirection };
    } else if (sortField === 'orderNo' || sortField === 'id') {
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
      data: data.map((order) => this.normalizeWorkshopOrder(order)),
      meta: {
        total,
        page,
        pageSize,
        pageCount: Math.ceil(total / pageSize),
      },
    };
  }

  async findOne(id: string) {
    const order = await this.prisma.workshopOrder.findUnique({
      where: { id },
      include: {
        customer: true,
        vehicle: true,
        invoice: true,
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

    return this.normalizeWorkshopOrder(order);
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
        invoice: true,
        tasks: {
          orderBy: { createdAt: 'asc' },
          include: {
            line_items: true,
          },
        },
      },
    });

    return this.normalizeWorkshopOrder(updated);
  }

  async createTask(orderId: string, dto: CreateWorkshopTaskDto) {
    return this.prisma.$transaction(async (tx) => {
      const order = await tx.workshopOrder.findUnique({
        where: { id: orderId },
        include: { tasks: true },
      });

      if (!order) {
        throw new NotFoundException(`Workshop order ${orderId} not found`);
      }
      this.assertOrderEditable(order.status);

      const task = await tx.workshopTask.create({
        data: {
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
        await tx.workshopOrder.update({
          where: { id: orderId },
          data: { status: nextOrderStatus },
        });
      }

      return {
        ...task,
        done: task.status === WorkshopTaskStatus.DONE,
        lineItems: [],
      };
    });
  }

  async updateTask(
    orderId: string,
    taskId: string,
    dto: UpdateWorkshopTaskDto,
  ) {
    await this.prisma.$transaction(async (tx) => {
      const task = await tx.workshopTask.findFirst({
        where: {
          id: taskId,
          workshop_order_id: orderId,
        },
        include: {
          workshop_order: {
            select: { status: true },
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
        where: { workshop_order_id: orderId },
        select: { status: true },
      });

      const nextOrderStatus = this.deriveOrderStatus(
        tasks.map((t) => t.status),
      );
      await tx.workshopOrder.update({
        where: { id: orderId },
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
    const task = await this.prisma.workshopTask.findFirst({
      where: {
        id: taskId,
        workshop_order_id: orderId,
      },
      include: {
        workshop_order: {
          select: { status: true },
        },
      },
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found for this order`);
    }
    this.assertOrderEditable(task.workshop_order.status);

    await this.prisma.$transaction(async (tx) => {
      await tx.workshopTaskLineItem.deleteMany({
        where: { workshop_task_id: taskId },
      });

      if (dto.items.length > 0) {
        await tx.workshopTaskLineItem.createMany({
          data: dto.items.map((item) => ({
            workshop_task_id: taskId,
            type:
              item.type === WorkshopLineItemType.LABOR
                ? WorkshopLineItemType.LABOR
                : WorkshopLineItemType.PART,
            item_no: item.itemNo,
            description: item.description,
            quantity: new Prisma.Decimal(item.qty),
            unit_price: new Prisma.Decimal(item.unitPrice),
          })),
        });
      }
    });

    return this.findOne(orderId);
  }

  async createInvoiceFromOrder(orderId: string) {
    return this.invoicesService.createDraftInvoice(orderId);
  }

  async search(query: string) {
    const isUuid =
      /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(
        query,
      );

    const page = 1;
    const limit = SEARCH_LIMIT;
    const skip = (page - 1) * limit;

    const vehicleWhere: Prisma.VehicleWhereInput = {
      OR: [
        { vin: { contains: query, mode: 'insensitive' } },
        { plate: { contains: query, mode: 'insensitive' } },
      ],
    };

    const customerWhere: Prisma.CustomerWhereInput = {
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
