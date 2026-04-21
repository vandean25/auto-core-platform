import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { TenantContextService } from '../common/services/tenant-context.service';

@Injectable()
export class VehicleService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
  ) {}

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
      params.pageSize && params.pageSize > 0 ? params.pageSize : 25;
    const pageSize = Math.min(resolvedPageSize, 100);
    const sortDirection = params.sortDirection ?? 'desc';

    const where: Prisma.VehicleWhereInput = params.search
      ? {
          tenant_id: tenantId,
          OR: [
            { make: { contains: params.search, mode: 'insensitive' } },
            { model: { contains: params.search, mode: 'insensitive' } },
            { plate: { contains: params.search, mode: 'insensitive' } },
            { vin: { contains: params.search, mode: 'insensitive' } },
            { engine_code: { contains: params.search, mode: 'insensitive' } },
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
          ],
        }
      : { tenant_id: tenantId };

    const sortField = params.sortField ?? 'createdAt';
    let orderBy: Prisma.VehicleOrderByWithRelationInput = {
      createdAt: sortDirection,
    };

    if (sortField === 'make') {
      orderBy = { make: sortDirection };
    } else if (sortField === 'model') {
      orderBy = { model: sortDirection };
    } else if (sortField === 'year') {
      orderBy = { year: sortDirection };
    } else if (sortField === 'plate') {
      orderBy = { plate: sortDirection };
    } else if (sortField === 'vin') {
      orderBy = { vin: sortDirection };
    } else if (sortField === 'customer') {
      orderBy = { customer: { last_name: sortDirection } };
    }

    const [data, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        include: { customer: true },
        skip: (page - 1) * pageSize,
        take: pageSize,
        orderBy,
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return {
      data,
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
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        customer: true,
        sales_orders: {
          orderBy: { createdAt: 'desc' },
          take: 20,
        },
        workshop_orders: {
          orderBy: { createdAt: 'desc' },
          take: 20,
          include: {
            tasks: {
              include: {
                line_items: true,
              },
            },
            invoice: {
              select: {
                id: true,
                invoice_number: true,
                status: true,
              },
            },
          },
        },
        invoices: {
          orderBy: { date: 'desc' },
          take: 20,
        },
      },
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${id} not found`);
    }

    return vehicle;
  }

  async update(id: string, updateVehicleDto: UpdateVehicleDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const existingVehicle = await this.prisma.vehicle.findFirst({
      where: { id, tenant_id: tenantId },
      select: { id: true },
    });

    if (!existingVehicle) {
      throw new NotFoundException(`Vehicle with ID ${id} not found`);
    }

    if (updateVehicleDto.customer_id) {
      const customerExists = await this.prisma.customer.findFirst({
        where: { id: updateVehicleDto.customer_id, tenant_id: tenantId },
        select: { id: true },
      });

      if (!customerExists) {
        throw new NotFoundException(
          `Customer with ID ${updateVehicleDto.customer_id} not found`,
        );
      }
    }

    const { customer_id, ...scalarData } = updateVehicleDto;
    const data: Prisma.VehicleUpdateInput = {
      ...scalarData,
      ...(customer_id !== undefined
        ? customer_id
          ? { customer: { connect: { id: customer_id } } }
          : { customer: { disconnect: true } }
        : {}),
    };

    try {
      const updatedVehicle = await this.prisma.vehicle.update({
        where: { id },
        data,
        include: { customer: true },
      });

      return updatedVehicle;
    } catch (error) {
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2025'
      ) {
        throw new NotFoundException('Vehicle not found');
      }
      if (
        error instanceof Prisma.PrismaClientKnownRequestError &&
        error.code === 'P2002'
      ) {
        const target = error.meta?.target;
        const fields = Array.isArray(target) ? target.join(', ') : undefined;
        throw new ConflictException(
          fields
            ? `Unique constraint failed on fields: ${fields}`
            : 'Unique constraint violation',
        );
      }
      throw error;
    }
  }
}
