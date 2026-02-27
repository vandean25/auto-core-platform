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
  InvoiceStatus,
  Prisma,
  WorkshopLineItemType,
  WorkshopOrderStatus,
  WorkshopTaskStatus,
} from '@prisma/client';
import { FinanceService } from '../finance/finance.service';

const DEFAULT_PAGE_SIZE = 25;
const MAX_PAGE_SIZE = 100;
const SEARCH_LIMIT = 100;

@Injectable()
export class WorkshopService {
  constructor(
    private prisma: PrismaService,
    private financeService: FinanceService,
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
      if (!exists) throw new NotFoundException(`Customer ${customerId} not found`);
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
                  { first_name: { contains: params.search, mode: 'insensitive' } },
                  { last_name: { contains: params.search, mode: 'insensitive' } },
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
    await this.findOne(id);

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

      const allTaskStatuses = [...order.tasks.map((t) => t.status), task.status];
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
      });

      if (!task) {
        throw new NotFoundException(`Task ${taskId} not found for this order`);
      }

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

      const nextOrderStatus = this.deriveOrderStatus(tasks.map((t) => t.status));
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
    });

    if (!task) {
      throw new NotFoundException(`Task ${taskId} not found for this order`);
    }

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
    await this.financeService.validateTransactionDate(new Date());

    const order = await this.prisma.workshopOrder.findUnique({
      where: { id: orderId },
      include: {
        tasks: {
          include: {
            line_items: true,
          },
        },
        invoice: true,
      },
    });

    if (!order) {
      throw new NotFoundException(`Workshop order ${orderId} not found`);
    }

    if (order.status !== WorkshopOrderStatus.COMPLETED) {
      throw new BadRequestException(
        'Only COMPLETED workshop orders can create invoices',
      );
    }

    const lineItems = order.tasks.flatMap((task) => task.line_items);
    if (lineItems.length === 0) {
      throw new BadRequestException(
        'Cannot create invoice because no labor/parts lines exist on tasks',
      );
    }

    const revenueGroups = await this.prisma.revenueGroup.findMany({
      select: { id: true, name: true, tax_rate: true },
    });
    const laborGroup = revenueGroups.find((group) =>
      /labor|service/i.test(group.name),
    );
    const partsGroup = revenueGroups.find((group) =>
      /part|goods/i.test(group.name),
    );
    if (!laborGroup || !partsGroup) {
      throw new BadRequestException(
        'Required revenue groups are missing. Configure labor and parts revenue groups before creating workshop invoices.',
      );
    }

    let totalNet = new Prisma.Decimal(0);
    let totalTax = new Prisma.Decimal(0);

    const invoiceItems = lineItems.map((line) => {
      const revenueGroup =
        line.type === WorkshopLineItemType.LABOR ? laborGroup : partsGroup;
      const quantity = new Prisma.Decimal(line.quantity);
      const unitPrice = new Prisma.Decimal(line.unit_price);
      const net = quantity.mul(unitPrice);
      const taxRate = new Prisma.Decimal(revenueGroup.tax_rate);
      const tax = net.mul(taxRate).div(100);

      totalNet = totalNet.add(net);
      totalTax = totalTax.add(tax);

      return {
        description: line.description,
        quantity,
        unit_price: unitPrice,
        tax_rate: taxRate,
        revenue_group_name: revenueGroup.name,
      };
    });

    const totalGross = totalNet.add(totalTax);

    const invoice = await this.prisma.$transaction(async (tx) => {
      const fetchedOrder = await tx.workshopOrder.findUnique({
        where: { id: orderId },
        include: {
          invoice: true,
          tasks: {
            include: {
              line_items: true,
            },
          },
        },
      });

      if (!fetchedOrder) {
        throw new NotFoundException(`Workshop order ${orderId} not found`);
      }

      if (fetchedOrder.invoice) {
        throw new BadRequestException('Workshop order is already invoiced');
      }

      const settings = await tx.financeSettings.update({
        where: { id: 1 },
        data: { next_invoice_number: { increment: 1 } },
      });
      const invoiceNumber = `${settings.invoice_prefix}${settings.next_invoice_number - 1}`;

      return tx.invoice.create({
        data: {
          invoice_number: invoiceNumber,
          customer_id: fetchedOrder.customer_id,
          vehicle_id: fetchedOrder.vehicle_id,
          workshop_order_id: fetchedOrder.id,
          status: InvoiceStatus.DRAFT,
          due_date: new Date(new Date().setDate(new Date().getDate() + 14)),
          total_net: totalNet,
          total_tax: totalTax,
          total_gross: totalGross,
          notes: fetchedOrder.notes,
          items: {
            create: invoiceItems,
          },
        },
      });
    });

    return invoice;
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

    const [vehicles, customers, vehicleTotal, customerTotal] = await Promise.all([
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
