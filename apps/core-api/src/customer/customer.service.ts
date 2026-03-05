import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

@Injectable()
export class CustomerService {
  constructor(private prisma: PrismaService) {}

  async create(createCustomerDto: CreateCustomerDto) {
    return this.prisma.customer.create({
      data: {
        type: createCustomerDto.type,
        company_name: createCustomerDto.company_name,
        // Map first/last name to single name field for backward compatibility or use both
        // The schema uses 'name' but we are switching to first/last in DTO.
        // We should update the schema to split names or concatenate here.
        // Looking at the schema update in previous step:
        // model Customer { ... first_name String, last_name String, name String ... }
        // Wait, did I keep 'name'?
        // The prompt said: first_name String, last_name String.
        // Let me check if 'name' was removed or kept.
        // I replaced the model. The new model has `first_name` and `last_name` but NOT `name`.
        // However, I need to double check the previous schema file reading.
        // Ah, the new model I pasted has `first_name` and `last_name` and removed `name`.
        // But the original `Customer` model had `name`.
        // If I removed `name`, I need to make sure I'm consistent.
        // Let's assume I replaced it correctly.

        first_name: createCustomerDto.first_name,
        last_name: createCustomerDto.last_name,
        // We might want to compute a display name or just rely on first/last
        email: createCustomerDto.email,
        phone: createCustomerDto.phone,
        vat_id: createCustomerDto.vat_id,
        address_street: createCustomerDto.address_street,
        address_city: createCustomerDto.address_city,
        address_zip: createCustomerDto.address_zip,
        address_country: createCustomerDto.address_country,
      },
    });
  }

  async findAll(params: any) {
    // If params is just a Prisma query object from QueryBuilder
    if (
      params &&
      (params.where || params.orderBy || params.skip !== undefined)
    ) {
      const [data, total] = await Promise.all([
        this.prisma.customer.findMany(params),
        this.prisma.customer.count({ where: params.where }),
      ]);
      return { data, total };
    }

    // Fallback for legacy calls (if any)
    const search = params as string;
    return this.prisma.customer.findMany({
      where: search
        ? {
            OR: [
              { first_name: { contains: search, mode: 'insensitive' } },
              { last_name: { contains: search, mode: 'insensitive' } },
              { company_name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : undefined,
      orderBy: [{ company_name: 'asc' }, { last_name: 'asc' }],
    });
  }

  async findOne(
    id: string,
    options?: { historyPage?: number; historyLimit?: number },
  ) {
    const historyPage =
      options?.historyPage && options.historyPage > 0 ? options.historyPage : 1;
    const requestedHistoryLimit =
      options?.historyLimit && options.historyLimit > 0
        ? options.historyLimit
        : DEFAULT_HISTORY_LIMIT;
    const historyLimit = Math.min(requestedHistoryLimit, MAX_HISTORY_LIMIT);
    const historySkip = (historyPage - 1) * historyLimit;

    const [customer, workshopOrdersTotal, invoicesTotal] = await Promise.all([
      this.prisma.customer.findUnique({
      where: { id },
      include: {
        vehicles: true,
        sales_orders: {
          orderBy: { createdAt: 'desc' },
          skip: historySkip,
          take: historyLimit,
        },
        workshop_orders: {
          orderBy: { createdAt: 'desc' },
          skip: historySkip,
          take: historyLimit,
          include: {
            tasks: {
              include: {
                line_items: {
                  select: {
                    quantity: true,
                    unit_price: true,
                  },
                },
              },
            },
            vehicle: true,
          },
        },
        invoices: {
          orderBy: { date: 'desc' },
          skip: historySkip,
          take: historyLimit,
        },
      },
    }),
      this.prisma.workshopOrder.count({ where: { customer_id: id } }),
      this.prisma.invoice.count({ where: { customer_id: id } }),
    ]);
    if (!customer)
      throw new NotFoundException(`Customer with ID ${id} not found`);

    const workshopOrderPageCount = Math.ceil(workshopOrdersTotal / historyLimit);
    const invoicesPageCount = Math.ceil(invoicesTotal / historyLimit);

    return {
      ...customer,
      workshop_orders_meta: {
        page: historyPage,
        pageSize: historyLimit,
        totalCount: workshopOrdersTotal,
        pageCount: workshopOrderPageCount,
        hasMore:
          historyPage < (workshopOrderPageCount === 0 ? 1 : workshopOrderPageCount),
      },
      invoices_meta: {
        page: historyPage,
        pageSize: historyLimit,
        totalCount: invoicesTotal,
        pageCount: invoicesPageCount,
        hasMore: historyPage < (invoicesPageCount === 0 ? 1 : invoicesPageCount),
      },
    };
  }

  async update(id: string, updateCustomerDto: UpdateCustomerDto) {
    await this.ensureCustomerExists(id);
    return this.prisma.customer.update({
      where: { id },
      data: updateCustomerDto,
    });
  }

  async remove(id: string) {
    await this.ensureCustomerExists(id);

    const [
      salesOrdersCount,
      invoicesCount,
      workshopOrdersCount,
      vehiclesCount,
    ] = await Promise.all([
      this.prisma.salesOrder.count({ where: { customer_id: id } }),
      this.prisma.invoice.count({ where: { customer_id: id } }),
      this.prisma.workshopOrder.count({ where: { customer_id: id } }),
      this.prisma.vehicle.count({ where: { customer_id: id } }),
    ]);

    if (salesOrdersCount > 0 || invoicesCount > 0 || workshopOrdersCount > 0) {
      throw new BadRequestException(
        'Customer cannot be deleted because it has linked orders or invoices. Use archive/deactivate instead.',
      );
    }

    if (vehiclesCount > 0) {
      throw new BadRequestException(
        'Customer cannot be deleted while vehicles are linked. Reassign or remove vehicles first.',
      );
    }

    return this.prisma.customer.delete({
      where: { id },
    });
  }

  private async ensureCustomerExists(id: string) {
    const customer = await this.prisma.customer.findUnique({
      where: { id },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }
  }
}
