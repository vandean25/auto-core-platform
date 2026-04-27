import {
  ConflictException,
  Injectable,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import type { Prisma as PrismaTypes } from '@prisma/client';
import {
  CreatePlatformTenantDto,
  ListPlatformTenantsQueryDto,
  UpdatePlatformTenantDto,
} from './dto/platform-tenant.dto';
import { SystemPrismaService } from '../prisma/system-prisma.service';

type PlatformTenantRecord = PrismaTypes.TenantGetPayload<{
  include: {
    _count: {
      select: { memberships: true };
    };
  };
}>;

@Injectable()
export class PlatformAdminService {
  constructor(private readonly systemPrisma: SystemPrismaService) {}

  async findAll(query: ListPlatformTenantsQueryDto) {
    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const skip = (page - 1) * limit;
    const where = this.buildTenantWhere(query);

    const [tenants, total] = await Promise.all([
      this.systemPrisma.tenant.findMany({
        where,
        include: {
          _count: {
            select: { memberships: true },
          },
        },
        orderBy: [{ created_at: 'asc' }],
        skip,
        take: limit,
      }),
      this.systemPrisma.tenant.count({ where }),
    ]);

    return {
      data: tenants.map((tenant) => this.mapTenant(tenant)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async create(dto: CreatePlatformTenantDto) {
    try {
      const tenant = await this.systemPrisma.$transaction(async (tx) => {
        const createdTenant = await tx.tenant.create({
          data: {
            name: dto.name.trim(),
            slug: dto.slug.trim().toLowerCase(),
            plan: dto.plan,
          },
          include: {
            _count: {
              select: { memberships: true },
            },
          },
        });

        await tx.financeSettings.create({
          data: this.buildDefaultFinanceSettings(createdTenant.id),
        });

        return createdTenant;
      });

      return this.mapTenant(tenant);
    } catch (error) {
      throw this.mapPersistenceError(error);
    }
  }

  async update(id: string, dto: UpdatePlatformTenantDto) {
    try {
      const updatedTenant = await this.systemPrisma.tenant.update({
        where: { id },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.slug !== undefined && { slug: dto.slug.trim().toLowerCase() }),
          ...(dto.plan !== undefined && { plan: dto.plan }),
          ...(dto.isActive !== undefined && { is_active: dto.isActive }),
        },
        include: {
          _count: {
            select: { memberships: true },
          },
        },
      });

      return this.mapTenant(updatedTenant);
    } catch (error) {
      throw this.mapPersistenceError(error);
    }
  }

  private buildTenantWhere(
    query: ListPlatformTenantsQueryDto,
  ): PrismaTypes.TenantWhereInput {
    const search = query.search?.trim();

    return {
      ...(query.includeInactive ? {} : { is_active: true }),
      ...(search
        ? {
            OR: [
              { name: { contains: search, mode: 'insensitive' } },
              { slug: { contains: search, mode: 'insensitive' } },
            ],
          }
        : {}),
    };
  }

  private buildDefaultFinanceSettings(tenantId: string) {
    const currentYear = new Date().getFullYear();

    return {
      tenant_id: tenantId,
      fiscal_year_start_month: 1,
      lock_date: null,
      next_invoice_number: 1001,
      invoice_prefix: `RE-${currentYear}-`,
      next_sales_order_number: 1001,
      sales_order_prefix: `SO-${currentYear}-`,
      next_workshop_order_number: 1,
      workshop_order_prefix: `WO-${currentYear}-`,
    };
  }

  private mapTenant(tenant: PlatformTenantRecord) {
    return {
      id: tenant.id,
      name: tenant.name,
      slug: tenant.slug,
      plan: tenant.plan,
      isActive: tenant.is_active,
      memberCount: tenant._count.memberships,
      createdAt: tenant.created_at,
      updatedAt: tenant.updated_at,
    };
  }

  private mapPersistenceError(error: unknown): Error {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      return new ConflictException('Tenant name or slug already exists.');
    }

    return error instanceof Error ? error : new Error(String(error));
  }
}