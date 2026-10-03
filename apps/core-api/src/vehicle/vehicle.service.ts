import {
  ConflictException,
  Inject,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service.js';
import { Prisma } from '@prisma/client';
import { UpdateVehicleDto } from './dto/update-vehicle.dto.js';
import { CreateVehicleDto } from './dto/create-vehicle.dto.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import {
  invoicesHistorySlice,
  salesOrdersHistorySlice,
  workshopOrdersHistorySlice,
} from '../common/queries/entity-history.query.js';
import { DEFAULT_HISTORY_LIMIT } from '../common/utils/history-pagination.util.js';
import {
  VEHICLE_IDENTITY_RESET,
  normalizeVehicleIdentityValue,
  normalizeVehicleIdentityValueOrNull,
  stripVehicleIdentityResolutionState,
} from './vehicle-identity.util.js';
import { VehicleQueryBuilder } from './vehicle-query.builder.js';
import { SiteContextService } from '../site/site-context.service.js';
import {
  projectVehicleOperationalFields,
  projectVehicleListOperationalFields,
} from '../common/projections/vehicle-entity.projection.js';
import {
  assertVehicleRegulatoryFields,
  normalizeVehicleRegulatoryFields,
} from './vehicle-regulatory.validation.js';
import { attachPickerlDue } from './pickerl/attach-pickerl-due.js';
import {
  PickerlDueListQueryDto,
  PickerlDueListExportQueryDto,
} from './dto/pickerl-due-list.dto.js';
import { csvEscape } from '../common/utils/csv-export.util.js';

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
    private readonly siteContext: SiteContextService,
  ) {}

  async getPickerlDueData(
    query: PickerlDueListQueryDto | PickerlDueListExportQueryDto,
  ) {
    const tenantId = await this.tenantContext.getTenantId();
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();

    // We fetch all customer vehicles and their latest inspection record
    const vehicles = await this.prisma.vehicle.findMany({
      where: {
        tenant_id: tenantId,
        inventory_role: 'CUSTOMER',
        // Approximate pre-filter using the index to skip vehicles definitely not due
        // We look for ones where the valid_until_year is <= next year, or no records exist.
        OR: [
          {
            inspection_records: {
              some: {
                plaketten_valid_until_year: {
                  lte: new Date().getFullYear() + 1,
                },
              },
            },
          },
          {
            inspection_records: { none: {} },
          },
        ],
      },
      include: {
        customer: true,
        inspection_records: {
          orderBy: { inspected_on: 'desc' },
          select: {
            inspected_on: true,
            plaketten_valid_until_year: true,
            plaketten_valid_until_month: true,
          },
        },
      },
    });

    const projected = projectVehicleListOperationalFields(
      vehicles.map(stripVehicleIdentityResolutionState),
      authorizedSiteIds,
    );

    const today = new Date();
    // UTC dates for computing Pickerl thresholds
    const todayYear = today.getUTCFullYear();
    const todayMonth = today.getUTCMonth() + 1;

    let futureThreshold = '';

    if (query.window) {
      const maxWindowDays = query.window;
      const futureDate = new Date(
        Date.UTC(todayYear, todayMonth - 1, today.getUTCDate() + maxWindowDays),
      );
      const futureYear = futureDate.getUTCFullYear();
      const futureMonth = futureDate.getUTCMonth() + 1; // 1-12
      futureThreshold = `${futureYear}-${futureMonth.toString().padStart(2, '0')}`;
    }

    const results = (projected || [])
      .map((v) => attachPickerlDue(v, today))
      .filter((v) => {
        // Filter by status if provided
        if (query.status && v.pickerl_due.status !== query.status) {
          return false;
        }

        // Filter by window if provided
        if (query.window) {
          // OVERDUE is always included when filtering by any window
          if (v.pickerl_due.status === 'OVERDUE') return true;

          if (!v.pickerl_due.due_month) {
            // If there's no due_month, we keep it only if the requested status is UNKNOWN
            return query.status === 'UNKNOWN';
          }

          // if due_month is greater than the window threshold, it falls outside the requested window
          if (v.pickerl_due.due_month > futureThreshold) return false;
        }

        return true;
      });

    // Sort: OVERDUE first, then by due_month ascending, then UNKNOWN
    results.sort((a, b) => {
      const rank = (s: string) =>
        s === 'OVERDUE' ? 1 : s === 'DUE_SOON' ? 2 : s === 'OK' ? 3 : 4;
      const rankDiff = rank(a.pickerl_due.status) - rank(b.pickerl_due.status);
      if (rankDiff !== 0) return rankDiff;

      const m1 = a.pickerl_due.due_month || '9999-99';
      const m2 = b.pickerl_due.due_month || '9999-99';
      return m1.localeCompare(m2);
    });

    return results;
  }

  async findPickerlDue(query: PickerlDueListQueryDto) {
    const allData = await this.getPickerlDueData(query);

    const page = query.page && query.page > 0 ? query.page : 1;
    const pageSize = query.pageSize && query.pageSize > 0 ? query.pageSize : 25;
    const skip = (page - 1) * pageSize;

    const paginatedData = allData.slice(skip, skip + pageSize);

    return {
      data: paginatedData,
      meta: {
        total: allData.length,
        page,
        pageSize,
        pageCount: Math.ceil(allData.length / pageSize),
      },
    };
  }

  async exportPickerlDueCsv(query: PickerlDueListExportQueryDto) {
    const allData = await this.getPickerlDueData(query);

    const header =
      'plate,vehicle,customer,due_month,status,last_inspected_on,phone,email';
    const lines = allData.map((row) => {
      const vehicleName = `${row.make} ${row.model}`;

      const customer = row.customer;
      let customerName = '';
      if (customer) {
        if (customer.company_name) {
          customerName = customer.company_name;
        } else {
          customerName = `${customer.first_name} ${customer.last_name}`.trim();
        }
      }

      const records = row as unknown as {
        inspection_records?: { inspected_on?: Date }[];
      };
      const lastInspectionDate = records.inspection_records?.[0]?.inspected_on;
      const lastInspectionStr = lastInspectionDate
        ? lastInspectionDate.toISOString().split('T')[0]
        : '';

      return [
        csvEscape(row.plate),
        csvEscape(vehicleName),
        csvEscape(customerName),
        csvEscape(row.pickerl_due.due_month),
        csvEscape(row.pickerl_due.status),
        csvEscape(lastInspectionStr),
        csvEscape(row.customer?.phone),
        csvEscape(row.customer?.email),
      ].join(',');
    });

    return [header, ...lines].join('\n');
  }

  async create(createVehicleDto: CreateVehicleDto) {
    const tenantId = await this.tenantContext.getTenantId();

    if (createVehicleDto.customer_id) {
      await this.validateCustomerExists(createVehicleDto.customer_id, tenantId);
    }

    const normalizedDto = normalizeVehicleRegulatoryFields(createVehicleDto);
    assertVehicleRegulatoryFields(normalizedDto);

    const data = this.buildCreatePayload(normalizedDto, tenantId);

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
    const authorizedSiteIds: string[] =
      await this.siteContext.listAuthorizedSiteIds();
    const { page, pageSize, skip, take } =
      VehicleQueryBuilder.resolvePagination(params.page, params.pageSize);
    const sortDirection =
      params.sortDirection ?? VehicleQueryBuilder.DEFAULT_SORT_DIRECTION;

    const where = VehicleQueryBuilder.buildWhere(tenantId, params.search);
    const orderBy = this.compute_orderby(params, sortDirection);

    const [data, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        include: {
          customer: true,
          location: true,
          reserved_for_customer: true,
        },
        skip,
        take,
        orderBy,
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return {
      data: projectVehicleListOperationalFields(
        data.map(stripVehicleIdentityResolutionState),
        authorizedSiteIds,
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
    const authorizedSiteIds: string[] =
      await this.siteContext.listAuthorizedSiteIds();
    const historySlice = { take: DEFAULT_HISTORY_LIMIT };
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        customer: true,
        location: true,
        reserved_for_customer: true,
        sales_orders: {
          ...salesOrdersHistorySlice(historySlice),
          where: { site_id: { in: authorizedSiteIds } },
        },
        workshop_orders: {
          ...workshopOrdersHistorySlice('vehicle-detail', historySlice),
          where: { site_id: { in: authorizedSiteIds } },
        },
        purchases: {
          where: { site_id: { in: authorizedSiteIds } },
          orderBy: { createdAt: 'desc' },
        },
        sales: {
          where: { site_id: { in: authorizedSiteIds } },
          orderBy: { createdAt: 'desc' },
        },
        invoices: invoicesHistorySlice(historySlice),
        inspection_records: {
          orderBy: { inspected_on: 'desc' },
          select: {
            inspected_on: true,
            plaketten_valid_until_year: true,
            plaketten_valid_until_month: true,
          },
        },
      },
    });

    if (!vehicle) {
      throw new NotFoundException(`Vehicle with ID ${id} not found`);
    }

    const projected = projectVehicleOperationalFields(
      stripVehicleIdentityResolutionState(vehicle),
      authorizedSiteIds,
    );
    return attachPickerlDue(projected, new Date());
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

    const normalizedDto = normalizeVehicleRegulatoryFields(updateVehicleDto);
    assertVehicleRegulatoryFields(normalizedDto);

    const data = this.prepareUpdatePayload(existingVehicle, normalizedDto);

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
  ): Prisma.VehicleUncheckedCreateInput {
    const { customer_id, vin, ...scalarData } = dto;

    return {
      ...scalarData,
      ...(vin !== undefined
        ? { vin: normalizeVehicleIdentityValueOrNull(vin) }
        : {}),
      tenant_id: tenantId,
      customer_id: customer_id ?? null,
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
