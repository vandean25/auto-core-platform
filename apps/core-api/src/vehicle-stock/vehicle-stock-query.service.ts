import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import {
  Prisma,
  VehicleInventoryRole,
  VehicleStockStatus,
} from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { costBasis } from './vehicle-cost';
import type { PatchVehicleStockDto } from './dto/patch-vehicle-stock.dto';

@Injectable()
export class VehicleStockQueryService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async list(params: {
    search?: string;
    stock_status?: VehicleStockStatus;
    page?: number;
    limit?: number;
  }) {
    const tenantId = await this.tenantContext.getTenantId();
    const page = params.page && params.page > 0 ? params.page : 1;
    const limit = Math.min(params.limit && params.limit > 0 ? params.limit : 25, 100);
    const where: Prisma.VehicleWhereInput = {
      tenant_id: tenantId,
      inventory_role: {
        in: [VehicleInventoryRole.USED, VehicleInventoryRole.NEW, VehicleInventoryRole.DEMO],
      },
      ...(params.stock_status ? { stock_status: params.stock_status } : {}),
      ...(params.search
        ? {
            OR: [
              { vin: { contains: params.search, mode: 'insensitive' } },
              { plate: { contains: params.search, mode: 'insensitive' } },
              { make: { contains: params.search, mode: 'insensitive' } },
              { model: { contains: params.search, mode: 'insensitive' } },
              { color: { contains: params.search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };

    const [data, total] = await Promise.all([
      this.prisma.vehicle.findMany({
        where,
        include: {
          reserved_for_customer: {
            select: {
              id: true,
              first_name: true,
              last_name: true,
              company_name: true,
              type: true,
            },
          },
          location: true,
        },
        orderBy: { updatedAt: 'desc' },
        skip: (page - 1) * limit,
        take: limit,
      }),
      this.prisma.vehicle.count({ where }),
    ]);

    return {
      data,
      meta: {
        total,
        page,
        limit,
        pageSize: limit,
        totalPages: Math.ceil(total / limit),
        pageCount: Math.ceil(total / limit),
      },
    };
  }

  async detail(vehicleId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
      include: {
        reserved_for_customer: {
          select: {
            id: true,
            first_name: true,
            last_name: true,
            company_name: true,
            type: true,
          },
        },
        location: true,
        purchases: { orderBy: { createdAt: 'desc' } },
        sales: { orderBy: { createdAt: 'desc' } },
        ledger_entries: { orderBy: { createdAt: 'asc' } },
        workshop_orders: {
          where: { purpose: 'STOCK_PREP' },
          orderBy: { createdAt: 'desc' },
          take: 10,
        },
      },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${vehicleId} not found`);
    }
    return {
      ...vehicle,
      cost_basis: costBasis(vehicle.ledger_entries),
    };
  }

  async patch(vehicleId: string, dto: PatchVehicleStockDto) {
    const tenantId = await this.tenantContext.getTenantId();
    const vehicle = await this.prisma.vehicle.findFirst({
      where: { id: vehicleId, tenant_id: tenantId },
    });
    if (!vehicle) {
      throw new NotFoundException(`Vehicle ${vehicleId} not found`);
    }
    if (vehicle.inventory_role !== VehicleInventoryRole.USED) {
      throw new ConflictException('Only used stock vehicles can be patched here');
    }

    if (dto.location_id) {
      const location = await this.prisma.storageLocation.findFirst({
        where: { id: dto.location_id, tenant_id: tenantId },
        select: { id: true },
      });
      if (!location) {
        throw new NotFoundException(`Location ${dto.location_id} not found`);
      }
    }
    if (dto.reserved_for_customer_id) {
      const customer = await this.prisma.customer.findFirst({
        where: { id: dto.reserved_for_customer_id, tenant_id: tenantId },
        select: { id: true },
      });
      if (!customer) {
        throw new NotFoundException(
          `Customer ${dto.reserved_for_customer_id} not found`,
        );
      }
    }

    const data: Prisma.VehicleUncheckedUpdateManyInput = {
      location_id: dto.location_id === undefined ? undefined : dto.location_id,
      mileage: dto.mileage,
      color: dto.color,
      key_number: dto.key_number,
      registration_certificate_no: dto.registration_certificate_no,
    };

    const where: Prisma.VehicleWhereInput = {
      id: vehicleId,
      tenant_id: tenantId,
      inventory_role: VehicleInventoryRole.USED,
    };

    if (dto.reserved_for_customer_id === null) {
      data.reserved_for_customer_id = null;
      if (vehicle.stock_status === VehicleStockStatus.RESERVED) {
        data.stock_status = VehicleStockStatus.IN_STOCK;
        where.stock_status = VehicleStockStatus.RESERVED;
      }
    } else if (dto.reserved_for_customer_id) {
      data.reserved_for_customer_id = dto.reserved_for_customer_id;
      data.stock_status = VehicleStockStatus.RESERVED;
      where.stock_status = {
        in: [VehicleStockStatus.IN_STOCK, VehicleStockStatus.RESERVED],
      };
    }

    const updated = await this.prisma.vehicle.updateMany({
      where,
      data,
    });
    if (updated.count === 0) {
      throw new ConflictException(
        'Vehicle status changed concurrently and cannot be patched',
      );
    }

    return this.detail(vehicleId);
  }
}
