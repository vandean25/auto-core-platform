import {
  ConflictException,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { CreateSiteDto, UpdateSiteDto } from './dto/site.dto.js';
import {
  fiscalRegisterUpsertArgs,
  isFiscalRegisterBindingComplete,
} from './site-fiscal-register.sync.js';
import { assertTenantAdmin } from './site.authorization.js';
import {
  countParkedVehicles,
  createSitePrerequisites,
  deleteSitePrerequisites,
} from './site.helpers.js';
import { buildSiteUpdateData } from './site-update.data.js';
import {
  assertSiteDeletable,
  assertSiteUpdatePayloadValid,
  validateSiteCreateInput,
  validateSiteUpdateInput,
} from './site.validator.js';

export class SiteLifecycleService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  async createSite(dto: CreateSiteDto) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const legalEntity = await this.prisma.legalEntity.findFirst({
      where: { id: dto.legalEntityId, tenant_id: tenantId },
      select: { id: true, is_active: true, country_iso: true },
    });
    if (!legalEntity) {
      throw new NotFoundException('Legal entity not found in this tenant');
    }
    if (!legalEntity.is_active) {
      throw new UnprocessableEntityException(
        'Cannot create a site under an inactive legal entity. Reactivate the entity first.',
      );
    }

    const existingCode = await this.prisma.site.findFirst({
      where: { tenant_id: tenantId, code: dto.code.trim() },
      select: { id: true },
    });
    if (existingCode) {
      throw new ConflictException(
        'A site with that code already exists in this tenant.',
      );
    }

    const { timezone, holidayCountry, slotMinutes, openingHours } =
      validateSiteCreateInput(dto, legalEntity.country_iso);

    return this.prisma.$transaction(async (tx) => {
      const lock = await tx.legalEntity.updateMany({
        where: { id: legalEntity.id, tenant_id: tenantId, is_active: true },
        data: { is_active: true },
      });
      if (lock.count !== 1) {
        throw new UnprocessableEntityException(
          'Cannot create a site under an inactive legal entity. Reactivate the entity first.',
        );
      }
      const site = await tx.site.create({
        data: {
          tenant_id: tenantId,
          legal_entity_id: legalEntity.id,
          code: dto.code.trim(),
          name: dto.name.trim(),
          address_street: dto.addressStreet ?? null,
          address_city: dto.addressCity ?? null,
          address_zip: dto.addressZip ?? null,
          address_country: dto.addressCountry ?? null,
          timezone,
          slot_minutes: slotMinutes,
          holiday_country_iso: holidayCountry,
          holiday_subdivision_code: dto.holidaySubdivisionCode ?? null,
          is_active: true,
        },
      });

      await createSitePrerequisites(tx, tenantId, site.id, openingHours);

      return site;
    });
  }

  async updateSite(id: string, dto: UpdateSiteDto) {
    assertTenantAdmin(this.tenantContext);
    assertSiteUpdatePayloadValid(dto);
    const tenantId = await this.tenantContext.getTenantId();

    const existing = await this.prisma.site.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Site not found');
    }

    const parentLegalEntityActive = await this.loadParentLegalEntityActive(
      dto,
      existing,
      tenantId,
    );
    validateSiteUpdateInput(dto, existing, parentLegalEntityActive);

    const site = await this.prisma.site.update({
      where: { id: existing.id },
      data: buildSiteUpdateData(dto, existing),
    });

    await this.syncFiscalRegister(tenantId, id, existing.legal_entity_id, dto);

    return site;
  }

  async deleteSite(id: string) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    const site = await this.prisma.site.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        storageLocations: { where: { deletedAt: null } },
        _count: {
          select: {
            memberships: true,
            bays: true,
            storageLocations: true,
            openingHours: true,
            holidays: true,
          },
        },
      },
    });
    if (!site) {
      throw new NotFoundException('Site not found');
    }

    const parkedVehicles = await countParkedVehicles(this.prisma, tenantId, id);
    const hasOnlySystemTransit = assertSiteDeletable(site, parkedVehicles);

    await this.prisma.$transaction(async (tx) => {
      await deleteSitePrerequisites(
        tx,
        tenantId,
        site.id,
        hasOnlySystemTransit,
      );
    });

    return { deleted: true };
  }

  private async loadParentLegalEntityActive(
    dto: UpdateSiteDto,
    existing: { is_active: boolean; legal_entity_id: string },
    tenantId: string,
  ): Promise<boolean | undefined> {
    if (dto.isActive !== true || existing.is_active) {
      return undefined;
    }
    const legalEntity = await this.prisma.legalEntity.findFirst({
      where: { tenant_id: tenantId, id: existing.legal_entity_id },
      select: { is_active: true },
    });
    return legalEntity?.is_active;
  }

  private async syncFiscalRegister(
    tenantId: string,
    siteId: string,
    legalEntityId: string,
    dto: UpdateSiteDto,
  ) {
    const binding = dto.fiscalRegister;
    if (!binding || !isFiscalRegisterBindingComplete(binding)) {
      return;
    }
    await this.prisma.fiscalRegister.upsert(
      fiscalRegisterUpsertArgs(tenantId, siteId, legalEntityId, binding),
    );
  }
}
