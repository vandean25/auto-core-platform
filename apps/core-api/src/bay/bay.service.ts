import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service';
import { TenantContextService } from '../common/services/tenant-context.service';
import { SiteContextService } from '../common/services/site-context.service';
import { CreateBayDto, ListBaysQueryDto, UpdateBayDto } from './dto/bay.dto';

@Injectable()
export class BayService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  private mapBay(bay: {
    id: string;
    name: string;
    is_active: boolean;
    sort_order: number;
    createdAt: Date;
    updatedAt: Date;
  }) {
    return {
      id: bay.id,
      name: bay.name,
      isActive: bay.is_active,
      sortOrder: bay.sort_order,
      createdAt: bay.createdAt,
      updatedAt: bay.updatedAt,
    };
  }

  private mapUniqueConstraintError(error: unknown) {
    if (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2002'
    ) {
      throw new ConflictException('Bay name already exists');
    }
  }

  async findAll(query: ListBaysQueryDto) {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const where = {
      tenant_id: tenantId,
      site_id: siteId,
      ...(query.includeInactive ? {} : { is_active: true }),
    };

    const page = Math.max(1, query.page ?? 1);
    const limit = Math.min(100, Math.max(1, query.limit ?? 25));
    const skip = (page - 1) * limit;

    const [bays, total] = await Promise.all([
      this.prisma.bay.findMany({
        where,
        orderBy: [{ sort_order: 'asc' }, { name: 'asc' }],
        skip,
        take: limit,
      }),
      this.prisma.bay.count({ where }),
    ]);

    return {
      data: bays.map((bay) => this.mapBay(bay)),
      meta: {
        total,
        page,
        limit,
        totalPages: Math.max(1, Math.ceil(total / limit)),
      },
    };
  }

  async findOne(id: string) {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const bay = await this.prisma.bay.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
    });
    if (!bay) {
      throw new NotFoundException(`Bay with ID ${id} not found`);
    }
    return this.mapBay(bay);
  }

  async create(dto: CreateBayDto) {
    try {
      const siteId = await this.siteContext.getSiteId();
      const created = await this.prisma.bay.create({
        data: {
          site_id: siteId,
          name: dto.name.trim(),
          is_active: dto.isActive ?? true,
          sort_order: dto.sortOrder ?? 0,
        } as Prisma.BayUncheckedCreateInput,
      });
      return this.mapBay(created);
    } catch (error) {
      this.mapUniqueConstraintError(error);
      throw error;
    }
  }

  async update(id: string, dto: UpdateBayDto) {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const existing = await this.prisma.bay.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
    });
    if (!existing) {
      throw new NotFoundException(`Bay with ID ${id} not found`);
    }

    try {
      const result = await this.prisma.bay.updateMany({
        where: { id, tenant_id: tenantId, site_id: siteId },
        data: {
          ...(dto.name !== undefined && { name: dto.name.trim() }),
          ...(dto.isActive !== undefined && { is_active: dto.isActive }),
          ...(dto.sortOrder !== undefined && { sort_order: dto.sortOrder }),
        },
      });
      if (result.count === 0) {
        throw new NotFoundException(`Bay with ID ${id} not found`);
      }
      const updated = await this.prisma.bay.findFirst({
        where: { id, tenant_id: tenantId, site_id: siteId },
      });
      if (!updated) {
        throw new NotFoundException(`Bay with ID ${id} not found`);
      }

      return this.mapBay(updated);
    } catch (error) {
      this.mapUniqueConstraintError(error);
      throw error;
    }
  }

  async remove(id: string) {
    const [tenantId, siteId] = await Promise.all([
      this.tenantContext.getTenantId(),
      this.siteContext.getSiteId(),
    ]);
    const existing = await this.prisma.bay.findFirst({
      where: { id, tenant_id: tenantId, site_id: siteId },
    });
    if (!existing) {
      throw new NotFoundException(`Bay with ID ${id} not found`);
    }

    const linkedOrders = await this.prisma.workshopOrder.count({
      where: { bay_id: id, tenant_id: tenantId, site_id: siteId },
    });
    if (linkedOrders > 0) {
      throw new ConflictException(
        `Cannot delete bay with ${linkedOrders} linked workshop orders`,
      );
    }

    if (existing.is_active) {
      const result = await this.prisma.bay.updateMany({
        where: { id, tenant_id: tenantId, site_id: siteId },
        data: { is_active: false },
      });
      if (result.count === 0) {
        throw new NotFoundException(`Bay with ID ${id} not found`);
      }
      const updated = await this.prisma.bay.findFirst({
        where: { id, tenant_id: tenantId, site_id: siteId },
      });
      if (!updated) {
        throw new NotFoundException(`Bay with ID ${id} not found`);
      }
      return { id: updated.id, isActive: updated.is_active };
    }

    await this.prisma.bay.deleteMany({
      where: { id, tenant_id: tenantId, site_id: siteId },
    });
    return { id, deleted: true };
  }
}
