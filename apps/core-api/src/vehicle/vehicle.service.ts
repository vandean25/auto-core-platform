import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { UpdateVehicleDto } from './dto/update-vehicle.dto';
import { CreateVehicleDto } from './dto/create-vehicle.dto';
import { TenantContextService } from '../common/services/tenant-context.service';
import {
  VEHICLE_IDENTITY_RESET,
  normalizeVehicleIdentityValue,
  normalizeVehicleIdentityValueOrNull,
  stripVehicleIdentityResolutionState,
} from './vehicle-identity.util';

@Injectable()
export class VehicleService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
  ) {}

  async create(createVehicleDto: CreateVehicleDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const { customer_id, vin, ...scalarData } = createVehicleDto;

    if (customer_id) {
      const customerExists = await this.prisma.customer.findFirst({
        where: { id: customer_id, tenant_id: tenantId },
        select: { id: true },
      });

      if (!customerExists) {
        throw new NotFoundException(
          `Customer with ID ${customer_id} not found`,
        );
      }
    }

    const data: Prisma.VehicleCreateInput = {
      ...scalarData,
      ...(vin !== undefined
        ? { vin: normalizeVehicleIdentityValueOrNull(vin) }
        : {}),
      tenant: { connect: { id: tenantId } },
      ...(customer_id ? { customer: { connect: { id: customer_id } } } : {}),
    };

    try {
      const createdVehicle = await this.prisma.vehicle.create({
        data,
        include: { customer: true },
      });

      return stripVehicleIdentityResolutionState(createdVehicle);
    } catch (error: unknown) {
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
      data: data.map(stripVehicleIdentityResolutionState),
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

    return stripVehicleIdentityResolutionState(vehicle);
  }

  async update(id: string, updateVehicleDto: UpdateVehicleDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const existingVehicle = await this.prisma.vehicle.findFirst({
      where: { id, tenant_id: tenantId },
      select: {
        id: true,
        vin: true,
        plate: true,
        identity_resolution_generation: true,
        identity_resolution_token: true,
      },
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

    const { customer_id, vin, ...scalarData } = updateVehicleDto;
    const originalVin = existingVehicle.vin;
    const originalPlate = existingVehicle.plate;
    const originalResolutionGeneration =
      existingVehicle.identity_resolution_generation ?? null;
    const originalResolutionToken =
      existingVehicle.identity_resolution_token ?? null;
    const identityChanged =
      (updateVehicleDto.vin !== undefined &&
        normalizeVehicleIdentityValue(existingVehicle.vin) !==
          normalizeVehicleIdentityValue(updateVehicleDto.vin)) ||
      (updateVehicleDto.plate !== undefined &&
        normalizeVehicleIdentityValue(existingVehicle.plate) !==
          normalizeVehicleIdentityValue(updateVehicleDto.plate));
    const data: Prisma.VehicleUncheckedUpdateManyInput = {
      ...scalarData,
      ...(vin !== undefined
        ? { vin: normalizeVehicleIdentityValueOrNull(vin) }
        : {}),
      ...(customer_id !== undefined ? { customer_id } : {}),
      ...(identityChanged
        ? { ...VEHICLE_IDENTITY_RESET, identity_resolution_token: null }
        : {}),
    };

    try {
      const updated = await this.prisma.vehicle.updateMany({
        where: {
          id,
          tenant_id: tenantId,
          vin: originalVin,
          plate: originalPlate,
          identity_resolution_generation: originalResolutionGeneration,
          identity_resolution_token: originalResolutionToken,
        },
        data,
      });
      if (updated.count === 0) {
        const currentVehicle = await this.prisma.vehicle.findFirst({
          where: { id, tenant_id: tenantId },
          select: { id: true },
        });
        if (currentVehicle) {
          throw new ConflictException(
            'Vehicle VIN or plate changed while updating; please retry',
          );
        }
        throw new NotFoundException('Vehicle not found');
      }

      const updatedVehicle = await this.prisma.vehicle.findFirst({
        where: { id, tenant_id: tenantId },
        include: { customer: true },
      });
      if (!updatedVehicle) {
        throw new NotFoundException('Vehicle not found');
      }

      return stripVehicleIdentityResolutionState(updatedVehicle);
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
