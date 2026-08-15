import {
  BadRequestException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import type { Customer, Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateCustomerDto } from './dto/create-customer.dto';
import { UpdateCustomerDto } from './dto/update-customer.dto';

const DEFAULT_HISTORY_LIMIT = 20;
const MAX_HISTORY_LIMIT = 100;

@Injectable()
export class CustomerService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async create(createCustomerDto: CreateCustomerDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const customer = await this.prisma.client.customer.create({
      data: {
        tenant_id: tenantId,
        type: createCustomerDto.type,
        company_name: createCustomerDto.company_name,
        first_name: createCustomerDto.first_name,
        last_name: createCustomerDto.last_name,
        email: createCustomerDto.email,
        phone: createCustomerDto.phone,
        vat_id: createCustomerDto.vat_id,
        address_street: createCustomerDto.address_street,
        address_city: createCustomerDto.address_city,
        address_zip: createCustomerDto.address_zip,
        address_country: createCustomerDto.address_country,
      },
    });

    return customer;
  }

  async findAll(
    params?: string | Prisma.CustomerFindManyArgs,
  ): Promise<{ data: Customer[]; total: number }> {
    const tenantId = await this.tenantContext.getTenantId();
    // If params is just a Prisma query object from QueryBuilder
    if (
      params &&
      typeof params === 'object' &&
      (params.where || params.orderBy || params.skip !== undefined)
    ) {
      const [data, total] = await Promise.all([
        this.prisma.client.customer.findMany({
          ...params,
          where: { ...(params.where ?? {}), tenant_id: tenantId },
        }),
        this.prisma.customer.count({
          where: { ...(params.where ?? {}), tenant_id: tenantId },
        }),
      ]);
      return { data, total };
    }

    // Fallback for legacy calls (if any)
    const search = typeof params === 'string' ? params : undefined;
    const result = await this.prisma.client.customer.findMany({
      where: search
        ? {
            tenant_id: tenantId,
            OR: [
              { first_name: { contains: search, mode: 'insensitive' } },
              { last_name: { contains: search, mode: 'insensitive' } },
              { company_name: { contains: search, mode: 'insensitive' } },
              { email: { contains: search, mode: 'insensitive' } },
            ],
          }
        : { tenant_id: tenantId },
      orderBy: [{ company_name: 'asc' }, { last_name: 'asc' }],
    });
    return { data: result, total: result.length };
  }

  async findOne(
    id: string,
    options?: { historyPage?: number; historyLimit?: number },
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const historyPage =
      options?.historyPage && options.historyPage > 0 ? options.historyPage : 1;
    const requestedHistoryLimit =
      options?.historyLimit && options.historyLimit > 0
        ? options.historyLimit
        : DEFAULT_HISTORY_LIMIT;
    const historyLimit = Math.min(requestedHistoryLimit, MAX_HISTORY_LIMIT);
    const historySkip = (historyPage - 1) * historyLimit;

    const [customer, workshopOrdersTotal, invoicesTotal] = await Promise.all([
      this.prisma.customer.findFirst({
        where: { id, tenant_id: tenantId },
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
      this.prisma.workshopOrder.count({
        where: { tenant_id: tenantId, customer_id: id },
      }),
      this.prisma.invoice.count({
        where: { tenant_id: tenantId, customer_id: id },
      }),
    ]);
    if (!customer)
      throw new NotFoundException(`Customer with ID ${id} not found`);

    const workshopOrderPageCount = Math.ceil(
      workshopOrdersTotal / historyLimit,
    );
    const invoicesPageCount = Math.ceil(invoicesTotal / historyLimit);

    return {
      ...customer,
      workshop_orders_meta: {
        page: historyPage,
        pageSize: historyLimit,
        totalCount: workshopOrdersTotal,
        pageCount: workshopOrderPageCount,
        hasMore:
          historyPage <
          (workshopOrderPageCount === 0 ? 1 : workshopOrderPageCount),
      },
      invoices_meta: {
        page: historyPage,
        pageSize: historyLimit,
        totalCount: invoicesTotal,
        pageCount: invoicesPageCount,
        hasMore:
          historyPage < (invoicesPageCount === 0 ? 1 : invoicesPageCount),
      },
    };
  }

  async update(id: string, updateCustomerDto: UpdateCustomerDto) {
    await this.ensureCustomerExists(id);
    const customer = await this.prisma.customer.update({
      where: { id },
      data: updateCustomerDto,
    });

    return customer;
  }

  async remove(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    await this.ensureCustomerExists(id);

    const [
      salesOrdersCount,
      invoicesCount,
      workshopOrdersCount,
      vehiclesCount,
      vehiclePurchasesCount,
      vehicleSalesCount,
    ] = await Promise.all([
      this.prisma.salesOrder.count({
        where: { tenant_id: tenantId, customer_id: id },
      }),
      this.prisma.invoice.count({
        where: { tenant_id: tenantId, customer_id: id },
      }),
      this.prisma.workshopOrder.count({
        where: { tenant_id: tenantId, customer_id: id },
      }),
      this.prisma.vehicle.count({
        where: { tenant_id: tenantId, customer_id: id },
      }),
      this.prisma.vehiclePurchase.count({
        where: { tenant_id: tenantId, customer_id: id },
      }),
      this.prisma.vehicleSale.count({
        where: { tenant_id: tenantId, customer_id: id },
      }),
    ]);

    if (
      salesOrdersCount > 0 ||
      invoicesCount > 0 ||
      workshopOrdersCount > 0 ||
      vehiclePurchasesCount > 0 ||
      vehicleSalesCount > 0
    ) {
      throw new BadRequestException(
        'Customer cannot be deleted because it has linked orders or invoices. Use archive/deactivate instead.',
      );
    }

    if (vehiclesCount > 0) {
      throw new BadRequestException(
        'Customer cannot be deleted while vehicles are linked. Reassign or remove vehicles first.',
      );
    }

    const deleteResult = await this.prisma.customer.deleteMany({
      where: { id, tenant_id: tenantId },
    });

    if (deleteResult.count === 0) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }

    return { id };
  }

  private async ensureCustomerExists(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const customer = await this.prisma.customer.findFirst({
      where: { id, tenant_id: tenantId },
      select: { id: true },
    });
    if (!customer) {
      throw new NotFoundException(`Customer with ID ${id} not found`);
    }
  }
}
