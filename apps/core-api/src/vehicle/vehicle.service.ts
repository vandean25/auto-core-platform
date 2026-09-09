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
  invoicesHistorySlice,
  salesOrdersHistorySlice,
  workshopOrdersHistorySlice,
} from '../common/queries/entity-history.query';
import { DEFAULT_HISTORY_LIMIT } from '../common/utils/history-pagination.util';
import {
  VEHICLE_IDENTITY_RESET,
  normalizeVehicleIdentityValue,
  normalizeVehicleIdentityValueOrNull,
  stripVehicleIdentityResolutionState,
} from './vehicle-identity.util';
import { VehicleQueryBuilder } from './vehicle-query.builder';

interface ExistingVehicleIdentity {
  id: string;
  vin: string | null;
  plate: string | null;
  identity_resolution_generation?: string | null;
  identity_resolution_token?: string | null;
}

@Injectable()
export class VehicleService {
  constructor(
    @Inject(PrismaService) private prisma: PrismaService,
    @Inject(TenantContextService)
    private readonly tenantContext: TenantContextService,
  ) {}

  async create(createVehicleDto: CreateVehicleDto) {
    const tenantId = await this.tenantContext.getTenantId();

    if (createVehicleDto.customer_id) {
      await this.validateCustomerExists(createVehicleDto.customer_id, tenantId);
    }

    const data = this.buildCreatePayload(createVehicleDto, tenantId);

    try {
      const createdVehicle = await this.prisma.vehicle.create({
        data,
        include: { customer: true },
      });

      return stripVehicleIdentityResolutionState(createdVehicle);
    } catch (error: unknown) {
      this.handlePrismaError(error);
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
    const { page, pageSize, skip, take } =
      VehicleQueryBuilder.resolvePagination(params.page, params.pageSize);
    const sortDirection =
      params.sortDirection ?? VehicleQueryBuilder.DEFAULT_SORT_DIRECTION;

    const where = VehicleQueryBuilder.buildWhere(tenantId, params.search);
    const orderBy = this.compute_orderby(params, sortDirection);

    const [data, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        include: { customer: true },
        skip,
        take,
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
    const historySlice = { take: DEFAULT_HISTORY_LIMIT };
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        customer: true,
        sales_orders: salesOrdersHistorySlice(historySlice),
        workshop_orders: workshopOrdersHistorySlice(
          'vehicle-detail',
          historySlice,
        ),
        invoices: invoicesHistorySlice(historySlice),
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
      await this.validateCustomerExists(updateVehicleDto.customer_id, tenantId);
    }

    const data = this.prepareUpdatePayload(existingVehicle, updateVehicleDto);

    try {
      const updated = await this.prisma.vehicle.updateMany({
        where: {
          id,
          tenant_id: tenantId,
          vin: existingVehicle.vin,
          plate: existingVehicle.plate,
          identity_resolution_generation:
            existingVehicle.identity_resolution_generation ?? null,
          identity_resolution_token:
            existingVehicle.identity_resolution_token ?? null,
        },
        data,
      });

      if (updated.count === 0) {
        await this.handleStaleOrMissingVehicle(id, tenantId);
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
      this.handlePrismaError(error);
    }
  }

  private compute_orderby(
    params: { sortField?: string },
    sortDirection: 'asc' | 'desc',
  ): Prisma.VehicleOrderByWithRelationInput {
    return VehicleQueryBuilder.computeOrderBy(params.sortField, sortDirection);
  }

  private async validateCustomerExists(
    customerId: string,
    tenantId: string,
  ): Promise<void> {
    const customerExists = await this.prisma.customer.findFirst({
      where: { id: customerId, tenant_id: tenantId },
      select: { id: true },
    });

    if (!customerExists) {
      throw new NotFoundException(`Customer with ID ${customerId} not found`);
    }
  }

  private buildCreatePayload(
    dto: CreateVehicleDto,
    tenantId: string,
  ): Prisma.VehicleCreateInput {
    const { customer_id, vin, ...scalarData } = dto;

    return {
      ...scalarData,
      ...(vin !== undefined
        ? { vin: normalizeVehicleIdentityValueOrNull(vin) }
        : {}),
      tenant: { connect: { id: tenantId } },
      ...(customer_id ? { customer: { connect: { id: customer_id } } } : {}),
    };
  }

  private prepareUpdatePayload(
    existingVehicle: ExistingVehicleIdentity,
    updateVehicleDto: UpdateVehicleDto,
  ): Prisma.VehicleUncheckedUpdateManyInput {
    const { customer_id, vin, ...scalarData } = updateVehicleDto;
    const identityChanged = this.hasIdentityChanged(
      existingVehicle,
      updateVehicleDto,
    );

    return {
      ...scalarData,
      ...(vin !== undefined
        ? { vin: normalizeVehicleIdentityValueOrNull(vin) }
        : {}),
      ...(customer_id !== undefined ? { customer_id } : {}),
      ...(identityChanged
        ? { ...VEHICLE_IDENTITY_RESET, identity_resolution_token: null }
        : {}),
    };
  }

  private hasIdentityChanged(
    existingVehicle: Pick<ExistingVehicleIdentity, 'vin' | 'plate'>,
    updateVehicleDto: UpdateVehicleDto,
  ): boolean {
    const vinChanged =
      updateVehicleDto.vin !== undefined &&
      normalizeVehicleIdentityValue(existingVehicle.vin) !==
        normalizeVehicleIdentityValue(updateVehicleDto.vin);

    const plateChanged =
      updateVehicleDto.plate !== undefined &&
      normalizeVehicleIdentityValue(existingVehicle.plate) !==
        normalizeVehicleIdentityValue(updateVehicleDto.plate);

    return vinChanged || plateChanged;
  }

  private async handleStaleOrMissingVehicle(
    id: string,
    tenantId: string,
  ): Promise<never> {
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

  private handlePrismaError(error: unknown): never {
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
