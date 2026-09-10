import {
  ConflictException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import { CreateLegalEntityDto, UpdateLegalEntityDto } from './dto/site.dto';
import { assertTenantAdmin } from './site.authorization';
import { isForeignKeyViolation } from './site.helpers';
import { validateLegalEntityCreateInput } from './site.validator';

@Injectable()
export class LegalEntityService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  /**
   * OWNER/ADMIN only. Includes inactive rows by default (ruling 53):
   * `GET /api/legal-entities` lists active AND inactive entities unless the
   * caller explicitly passes `includeInactive=false`.
   */
  async listLegalEntities(includeInactive = true) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.legalEntity.findMany({
      where: {
        tenant_id: tenantId,
        ...(includeInactive ? {} : { is_active: true }),
      },
      orderBy: { name: 'asc' },
    });
  }

  async createLegalEntity(dto: CreateLegalEntityDto) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const existing = await this.prisma.legalEntity.findFirst({
      where: { tenant_id: tenantId, name: dto.name.trim() },
      select: { id: true },
    });

    validateLegalEntityCreateInput(dto, existing);

    return this.prisma.legalEntity.create({
      data: {
        tenant_id: tenantId,
        name: dto.name.trim(),
        country_iso: dto.countryIso,
        is_active: true,
      },
    });
  }

  async updateLegalEntity(id: string, dto: UpdateLegalEntityDto) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.prisma.legalEntity.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Legal entity not found');
    }

    // country_iso is immutable after create (ruling 326)
    if (dto.isActive === false) {
      return this.prisma.$transaction(async (tx) => {
        // A no-op update takes a row lock, serializing this check with
        // createSite's matching lock before either operation commits.
        const lock = await tx.legalEntity.updateMany({
          where: { id: existing.id, tenant_id: tenantId, is_active: true },
          data: { is_active: true },
        });
        if (lock.count !== 1) {
          throw new ConflictException(
            'Cannot deactivate an inactive or concurrently changed legal entity.',
          );
        }
        const activeSite = await tx.site.findFirst({
          where: { tenant_id: tenantId, legal_entity_id: id, is_active: true },
          select: { id: true },
        });
        if (activeSite) {
          throw new ConflictException(
            'Cannot deactivate a legal entity that still has an active site.',
          );
        }
        return tx.legalEntity.update({
          where: { id: existing.id },
          data: { name: dto.name?.trim() ?? existing.name, is_active: false },
        });
      });
    }

    return this.prisma.legalEntity.update({
      where: { id: existing.id },
      data: {
        name: dto.name?.trim() ?? existing.name,
        is_active: dto.isActive ?? existing.is_active,
      },
    });
  }

  async deleteLegalEntity(id: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.prisma.legalEntity.findFirst({
      where: { id, tenant_id: tenantId },
      include: { _count: { select: { sites: true } } },
    });
    if (!existing) {
      throw new NotFoundException('Legal entity not found');
    }

    if (existing._count.sites > 0) {
      throw new ConflictException(
        'Cannot hard-delete a legal entity that has sites. Deactivate the entity instead.',
      );
    }

    try {
      await this.prisma.legalEntity.delete({ where: { id: existing.id } });
    } catch (error) {
      if (isForeignKeyViolation(error)) {
        throw new ConflictException(
          'Legal entity is referenced by other records and cannot be deleted.',
        );
      }
      throw error;
    }
  }

  /**
   * Guard: legal entity deactivation is 422 while any site of the entity is
   * still active (ruling 38).
   */
  async guardLegalEntityDeactivation(tenantId: string, legalEntityId: string) {
    const activeSite = await this.prisma.site.findFirst({
      where: {
        tenant_id: tenantId,
        legal_entity_id: legalEntityId,
        is_active: true,
      },
      select: { id: true },
    });
    if (activeSite) {
      throw new ConflictException(
        'Cannot deactivate a legal entity that still has an active site.',
      );
    }
  }
}
