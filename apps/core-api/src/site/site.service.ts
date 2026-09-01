import {
  BadRequestException,
  ConflictException,
  ForbiddenException,
  Injectable,
  NotFoundException,
} from '@nestjs/common';
import { Prisma } from '@prisma/client';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLegalEntityDto,
  CreateSiteDto,
  CreateSiteMembershipDto,
  SUPPORTED_LEGAL_ENTITY_COUNTRIES,
  UpdateSiteDto,
} from './dto/site.dto';

const SYSTEM_LOCATION_TYPE = 'in_transit';
const SYSTEM_LOCATION_CODE = 'TRANSIT';
const DEALER_STOCK_STATUSES = ['IN_STOCK', 'RESERVED', 'IN_PREP'] as const;
const DEALER_INVENTORY_ROLES = ['USED', 'NEW', 'DEMO'] as const;

type TenantAdminUser = {
  role?: string;
};

/**
 * Service-layer foundation for the Multi-Location slice 1 (AUT-252 / ADR-0022).
 *
 * Covers:
 *  - LegalEntity / Site / SiteMembership creation with validation
 *  - immutable `Site.legal_entity_id`
 *  - deactivation + hard-delete guards matching docs/deletion-policy.md
 *  - system (`in_transit`, MAIN `LOT`) location delete guards
 *  - cross-tenant FK rejection via composite FKs (DB) and service checks
 */
@Injectable()
export class SiteService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // ---------------------------------------------------------------------------
  // LegalEntity
  // ---------------------------------------------------------------------------

  async listLegalEntities(includeInactive = false) {
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
    this.assertTenantAdmin();
    const tenantId = await this.tenantContext.getTenantId();

    const countryIso = dto.countryIso;
    if (!SUPPORTED_LEGAL_ENTITY_COUNTRIES.includes(countryIso)) {
      throw new BadRequestException(
        `countryIso must be one of ${SUPPORTED_LEGAL_ENTITY_COUNTRIES.join(', ')}`,
      );
    }

    const existing = await this.prisma.legalEntity.findFirst({
      where: { tenant_id: tenantId, name: dto.name.trim() },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'A legal entity with that name already exists in this tenant.',
      );
    }

    return this.prisma.legalEntity.create({
      data: {
        tenant_id: tenantId,
        name: dto.name.trim(),
        country_iso: countryIso,
        is_active: true,
      },
    });
  }

  async updateLegalEntity(
    id: string,
    dto: { name?: string; isActive?: boolean },
  ) {
    this.assertTenantAdmin();
    const tenantId = await this.tenantContext.getTenantId();
    const existing = await this.prisma.legalEntity.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Legal entity not found');
    }

    // country_iso is immutable after create (ruling 326)
    if (dto.isActive === false) {
      await this.guardLegalEntityDeactivation(tenantId, id);
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
    this.assertTenantAdmin();
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
      if (this.isForeignKeyViolation(error)) {
        throw new ConflictException(
          'Legal entity is referenced by other records and cannot be deleted.',
        );
      }
      throw error;
    }
  }

  // ---------------------------------------------------------------------------
  // Site
  // ---------------------------------------------------------------------------

  async listSites(includeInactive = false) {
    const tenantId = await this.tenantContext.getTenantId();
    const rows = await this.prisma.site.findMany({
      where: {
        tenant_id: tenantId,
        ...(includeInactive ? {} : { is_active: true }),
      },
      orderBy: [{ code: 'asc' }],
      include: includeInactive
        ? {
            legal_entity: {
              select: { id: true, name: true, country_iso: true },
            },
            openingHours: { orderBy: { weekday: 'asc' } },
            _count: {
              select: { memberships: true, bays: true, storageLocations: true },
            },
          }
        : {
            legal_entity: { select: { id: true, name: true } },
          },
    });

    if (includeInactive) {
      return rows;
    }

    // Names-only directory (ruling 12): { id, code, name, legalEntityId }
    return rows.map((site) => ({
      id: site.id,
      code: site.code,
      name: site.name,
      legalEntityId: site.legal_entity_id,
      legalEntityName: site.legal_entity?.name,
    }));
  }

  async getSite(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    const site = await this.prisma.site.findFirst({
      where: { id, tenant_id: tenantId },
      include: {
        legal_entity: true,
        openingHours: { orderBy: { weekday: 'asc' } },
        memberships: {
          include: {
            user: {
              select: {
                id: true,
                email: true,
                firstName: true,
                lastName: true,
              },
            },
          },
        },
        storageLocations: { where: { deletedAt: null } },
      },
    });
    if (!site) {
      throw new NotFoundException('Site not found');
    }
    return site;
  }

  async createSite(dto: CreateSiteDto) {
    this.assertTenantAdmin();
    const tenantId = await this.tenantContext.getTenantId();

    // POST /api/sites → 422 unless the legal entity is active (ruling 4)
    const legalEntity = await this.prisma.legalEntity.findFirst({
      where: { id: dto.legalEntityId, tenant_id: tenantId },
      select: { id: true, is_active: true },
    });
    if (!legalEntity) {
      throw new NotFoundException('Legal entity not found in this tenant');
    }
    if (!legalEntity.is_active) {
      throw new ConflictException(
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

    const site = await this.prisma.site.create({
      data: {
        tenant_id: tenantId,
        legal_entity_id: legalEntity.id,
        code: dto.code.trim(),
        name: dto.name.trim(),
        address_street: dto.addressStreet ?? null,
        address_city: dto.addressCity ?? null,
        address_zip: dto.addressZip ?? null,
        address_country: dto.addressCountry ?? null,
        timezone: 'Europe/Vienna',
        slot_minutes: 30,
        holiday_country_iso: 'AT',
        is_active: true,
      },
    });

    // Every site gets its system in_transit location + a default LOT (ruling 34, 40)
    await this.prisma.storageLocation.createMany({
      data: [
        {
          tenant_id: tenantId,
          site_id: site.id,
          code: SYSTEM_LOCATION_CODE,
          name: 'In Transit',
          type: SYSTEM_LOCATION_TYPE,
          is_system: true,
        },
        {
          tenant_id: tenantId,
          site_id: site.id,
          code: 'LOT',
          name: 'Vehicle Lot',
          type: 'vehicle_lot',
          is_system: false,
        },
      ],
      skipDuplicates: true,
    });

    return site;
  }

  async updateSite(id: string, dto: UpdateSiteDto) {
    this.assertTenantAdmin();
    const tenantId = await this.tenantContext.getTenantId();

    // Reject any attempt to change legal_entity_id — the field is immutable
    // after insert (ruling 4). The DTO has no legalEntityId field; a raw
    // attempt to sneak one in is a client error, not a silent mutation.
    const attemptedLegalEntityChange = (dto as { legalEntityId?: unknown })
      .legalEntityId;
    if (attemptedLegalEntityChange !== undefined) {
      throw new BadRequestException(
        'Site.legal_entity_id is immutable and cannot be changed.',
      );
    }

    const existing = await this.prisma.site.findFirst({
      where: { id, tenant_id: tenantId },
    });
    if (!existing) {
      throw new NotFoundException('Site not found');
    }

    if (dto.isActive === true && !existing.is_active) {
      const legalEntity = await this.prisma.legalEntity.findFirst({
        where: { tenant_id: tenantId, id: existing.legal_entity_id },
        select: { is_active: true },
      });
      if (!legalEntity?.is_active) {
        throw new ConflictException(
          'Cannot reactivate a site whose legal entity is inactive. Reactivate the entity first.',
        );
      }
    }

    if (dto.isActive === false) {
      await this.guardSiteDeactivation(tenantId, id);
    }

    return this.prisma.site.update({
      where: { id: existing.id },
      data: {
        name: dto.name?.trim() ?? existing.name,
        address_street:
          dto.addressStreet === undefined
            ? existing.address_street
            : dto.addressStreet,
        address_city:
          dto.addressCity === undefined
            ? existing.address_city
            : dto.addressCity,
        address_zip:
          dto.addressZip === undefined ? existing.address_zip : dto.addressZip,
        address_country:
          dto.addressCountry === undefined
            ? existing.address_country
            : dto.addressCountry,
        is_active: dto.isActive ?? existing.is_active,
      },
    });
  }

  async deleteSite(id: string) {
    this.assertTenantAdmin();
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

    // Hard delete only for a pristine unused site (deletion policy Site row).
    // Opening hours / holidays / the empty system in_transit location may be
    // removed internally with the site (deletion policy: "Pristine site
    // hard-delete may internally remove its empty system transit location and
    // hours/holiday config").
    if (site._count.memberships > 0) {
      throw new ConflictException(
        'Cannot hard-delete a site that has memberships.',
      );
    }
    if (site._count.bays > 0) {
      throw new ConflictException('Cannot hard-delete a site that has bays.');
    }
    const hasOnlySystemTransit =
      site.storageLocations.length === 1 &&
      site.storageLocations[0].is_system &&
      site.storageLocations[0].type === SYSTEM_LOCATION_TYPE;
    if (!hasOnlySystemTransit) {
      throw new ConflictException(
        'Cannot hard-delete a site that has storage locations other than its empty system in_transit location.',
      );
    }

    const parkedVehicles = await this.prisma.vehicle.count({
      where: {
        tenant_id: tenantId,
        inventory_role: { in: [...DEALER_INVENTORY_ROLES] },
        stock_status: { in: [...DEALER_STOCK_STATUSES] },
        location: { site_id: id },
      },
    });
    if (parkedVehicles > 0) {
      throw new ConflictException(
        'Cannot hard-delete a site that has parked dealer vehicles on a lot at this site.',
      );
    }

    await this.prisma.$transaction(async (tx) => {
      if (hasOnlySystemTransit) {
        await tx.storageLocation.deleteMany({
          where: {
            tenant_id: tenantId,
            site_id: id,
            is_system: true,
            type: SYSTEM_LOCATION_TYPE,
          },
        });
      }
      // Pristine-site hard delete removes its hours/holiday config internally.
      await tx.workshopOpeningHour.deleteMany({
        where: { tenant_id: tenantId, site_id: id },
      });
      await tx.workshopHoliday.deleteMany({
        where: { tenant_id: tenantId, site_id: id },
      });
      await tx.site.delete({ where: { id: site.id } });
    });

    return { deleted: true };
  }

  /**
   * Resolves the tenant's MAIN (default) site. Falls back to the first active
   * site ordered by code. Used by services that must stamp site_id but do not
   * have a SiteContext yet (single-site legacy tenants have exactly one site).
   */
  async resolveDefaultSiteId(tenantId: string): Promise<string> {
    const site = await this.prisma.site.findFirst({
      where: { tenant_id: tenantId },
      orderBy: [{ is_active: 'desc' }, { code: 'asc' }],
      select: { id: true },
    });
    if (!site) {
      throw new NotFoundException(
        'No site exists for this tenant. Create a site before creating site-scoped records.',
      );
    }
    return site.id;
  }

  async resolveDefaultSite(tenantId: string) {
    return this.prisma.site.findFirst({
      where: { tenant_id: tenantId },
      orderBy: [{ is_active: 'desc' }, { code: 'asc' }],
    });
  }

  // ---------------------------------------------------------------------------
  // SiteMembership
  // ---------------------------------------------------------------------------

  async listSiteMemberships(siteId: string) {
    const tenantId = await this.tenantContext.getTenantId();
    await this.assertSiteInTenant(tenantId, siteId);
    return this.prisma.siteMembership.findMany({
      where: { tenant_id: tenantId, site_id: siteId },
      include: {
        user: {
          select: { id: true, email: true, firstName: true, lastName: true },
        },
        tenantMember: { select: { role: true, is_active: true } },
      },
    });
  }

  async addSiteMembership(siteId: string, dto: CreateSiteMembershipDto) {
    this.assertTenantAdmin();
    const tenantId = await this.tenantContext.getTenantId();
    await this.assertSiteInTenant(tenantId, siteId);

    // POST /api/sites/:id/memberships → 422 unless an active TenantMember
    // exists for that (tenant_id, user_id). The composite FK backs this up.
    const member = await this.prisma.tenantMember.findFirst({
      where: { tenant_id: tenantId, user_id: dto.userId },
      select: { id: true, is_active: true },
    });
    if (!member) {
      throw new BadRequestException(
        'No TenantMember exists for that user in this tenant.',
      );
    }
    if (!member.is_active) {
      throw new ConflictException(
        'Cannot grant a site membership to an inactive TenantMember.',
      );
    }

    const existing = await this.prisma.siteMembership.findFirst({
      where: { tenant_id: tenantId, user_id: dto.userId, site_id: siteId },
      select: { id: true },
    });
    if (existing) {
      throw new ConflictException(
        'That user already has a membership in this site.',
      );
    }

    return this.prisma.siteMembership.create({
      data: {
        tenant_id: tenantId,
        user_id: dto.userId,
        site_id: siteId,
        is_active: true,
      },
    });
  }

  async removeSiteMembership(siteId: string, userId: string) {
    this.assertTenantAdmin();
    const tenantId = await this.tenantContext.getTenantId();
    await this.assertSiteInTenant(tenantId, siteId);

    const membership = await this.prisma.siteMembership.findFirst({
      where: { tenant_id: tenantId, site_id: siteId, user_id: userId },
    });
    if (!membership) {
      throw new NotFoundException('Site membership not found');
    }

    await this.prisma.$transaction(async (tx) => {
      await tx.siteMembership.delete({ where: { id: membership.id } });
      // Ruling 10: removing a membership that matches User.active_site_id
      // clears active_site_id atomically (null).
      await tx.user.updateMany({
        where: { active_site_id: siteId, id: userId },
        data: { active_site_id: null },
      });
    });

    return { deleted: true };
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  /**
   * Guard: legal entity deactivation is 422 while any site of the entity is
   * still active (ruling 38).
   */
  private async guardLegalEntityDeactivation(
    tenantId: string,
    legalEntityId: string,
  ) {
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

  /**
   * Guard: site deactivation. Blocks when:
   *   - on-hand or reserved qty exists at any site location
   *   - a parked dealer vehicle's lot belongs to this site
   * Document-site terminal checks arrive with the SiteContext issue (site_id
   * is not yet stamped on workshop/sales/purchase/vehicle documents).
   *
   * Note: the ruling-41 serialization (site-row `SELECT … FOR UPDATE` plus
   * recheck) is deferred to the SiteContext/operational-split issue. Prisma
   * raw `$executeRaw` is banned by AUT-65, and a typed Prisma row lock needs
   * the operational write paths that stamp site_id. Until then, deactivation
   * and creates race exactly as they do today for tenant-level checks.
   */
  async guardSiteDeactivation(tenantId: string, siteId: string) {
    const [stockQty, parkedVehicles] = await Promise.all([
      this.prisma.inventoryStock.count({
        where: {
          tenant_id: tenantId,
          location: { site_id: siteId },
          OR: [
            { quantity_on_hand: { gt: 0 } },
            { quantity_reserved: { gt: 0 } },
          ],
        },
      }),
      this.prisma.vehicle.count({
        where: {
          tenant_id: tenantId,
          inventory_role: { in: [...DEALER_INVENTORY_ROLES] },
          stock_status: { in: [...DEALER_STOCK_STATUSES] },
          location: { site_id: siteId },
        },
      }),
    ]);

    if (stockQty > 0) {
      throw new ConflictException(
        'Cannot deactivate a site with on-hand or reserved stock at its locations.',
      );
    }
    if (parkedVehicles > 0) {
      throw new ConflictException(
        'Cannot deactivate a site with parked dealer vehicles on a lot at this site.',
      );
    }
  }

  private async assertSiteInTenant(tenantId: string, siteId: string) {
    const site = await this.prisma.site.findFirst({
      where: { tenant_id: tenantId, id: siteId },
      select: { id: true },
    });
    if (!site) {
      throw new NotFoundException('Site not found in this tenant');
    }
  }

  private assertTenantAdmin() {
    const user = this.tenantContext.getAuthenticatedUser() as
      TenantAdminUser | undefined;
    if (!user || (user.role !== 'ADMIN' && user.role !== 'OWNER')) {
      throw new ForbiddenException('Tenant admin access is required.');
    }
  }

  private isForeignKeyViolation(error: unknown): boolean {
    return (
      error instanceof Prisma.PrismaClientKnownRequestError &&
      error.code === 'P2003'
    );
  }
}
