import {
  ConflictException,
  Injectable,
  NotFoundException,
  Optional,
  UnprocessableEntityException,
} from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service';
import { PrismaService } from '../prisma/prisma.service';
import {
  CreateLegalEntityDto,
  CreateSiteDto,
  CreateSiteMembershipDto,
  UpdateLegalEntityDto,
  UpdateSiteDto,
} from './dto/site.dto';
import { LegalEntityService } from './legal-entity.service';
import {
  assertActiveMemberWithSiteAccess,
  assertSiteReadAccess,
  assertTenantAdmin,
} from './site.authorization';
import {
  countParkedVehicles,
  createSitePrerequisites,
  deleteSitePrerequisites,
} from './site.helpers';
import { SiteMembershipService } from './site-membership.service';
import {
  assertSiteDeletable,
  assertSiteUpdatePayloadValid,
  validateSiteCreateInput,
  validateSiteUpdateInput,
} from './site.validator';

/**
 * Service-layer foundation for the Multi-Location slice 1 (AUT-252 / ADR-0022).
 *
 * Covers:
 *  - LegalEntity / Site / SiteMembership creation with validation
 *  - immutable `Site.legal_entity_id`
 *  - read authorization per rulings 12/44/53
 *  - deactivation is REJECTED until the serialized guard (ruling 41) lands
 *  - hard-delete guards matching docs/deletion-policy.md
 *  - system (`in_transit`) location delete guards
 *  - cross-tenant FK rejection via composite FKs (DB) and service checks
 */
@Injectable()
export class SiteService {
  private readonly membershipService: SiteMembershipService;
  private readonly legalEntityService: LegalEntityService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    @Optional() membershipService?: SiteMembershipService,
    @Optional() legalEntityService?: LegalEntityService,
  ) {
    this.membershipService =
      membershipService ??
      new SiteMembershipService(this.prisma, this.tenantContext);
    this.legalEntityService =
      legalEntityService ??
      new LegalEntityService(this.prisma, this.tenantContext);
  }

  // ---------------------------------------------------------------------------
  // LegalEntity (delegated to LegalEntityService)
  // ---------------------------------------------------------------------------

  /**
   * OWNER/ADMIN only. Includes inactive rows by default (ruling 53):
   * `GET /api/legal-entities` lists active AND inactive entities unless the
   * caller explicitly passes `includeInactive=false`.
   */
  async listLegalEntities(includeInactive = true) {
    return this.legalEntityService.listLegalEntities(includeInactive);
  }

  async createLegalEntity(dto: CreateLegalEntityDto) {
    return this.legalEntityService.createLegalEntity(dto);
  }

  async updateLegalEntity(id: string, dto: UpdateLegalEntityDto) {
    return this.legalEntityService.updateLegalEntity(id, dto);
  }

  async deleteLegalEntity(id: string) {
    return this.legalEntityService.deleteLegalEntity(id);
  }

  // ---------------------------------------------------------------------------
  // Site — reads (rulings 12/44/53)
  // ---------------------------------------------------------------------------

  /**
   * Names-only active directory (default): any user with an active TenantMember
   * AND at least one active SiteMembership may list active sites.
   * `includeInactive=true` is OWNER/ADMIN and returns full rows (active and
   * inactive) without requiring a SiteMembership (ruling 53).
   */
  async listSites(includeInactive = false) {
    const tenantId = await this.tenantContext.getTenantId();

    if (includeInactive) {
      assertTenantAdmin(this.tenantContext);
      return this.prisma.site.findMany({
        where: { tenant_id: tenantId },
        orderBy: [{ code: 'asc' }],
        include: {
          legal_entity: {
            select: { id: true, name: true, country_iso: true },
          },
          openingHours: { orderBy: { weekday: 'asc' } },
          _count: {
            select: { memberships: true, bays: true, storageLocations: true },
          },
        },
      });
    }

    await assertActiveMemberWithSiteAccess(
      this.prisma,
      this.tenantContext,
      tenantId,
    );
    const rows = await this.prisma.site.findMany({
      where: { tenant_id: tenantId, is_active: true },
      orderBy: [{ code: 'asc' }],
      include: {
        legal_entity: { select: { id: true, name: true } },
      },
    });

    // Names-only directory (ruling 12): { id, code, name, legalEntityId }
    return rows.map((site) => ({
      id: site.id,
      code: site.code,
      name: site.name,
      legalEntityId: site.legal_entity_id,
      legalEntityName: site.legal_entity?.name,
    }));
  }

  /**
   * getSite requires an active SiteMembership on that site OR OWNER/ADMIN.
   */
  async getSite(id: string) {
    const tenantId = await this.tenantContext.getTenantId();
    await assertSiteReadAccess(this.prisma, this.tenantContext, tenantId, id);
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

  // ---------------------------------------------------------------------------
  // Site — writes
  // ---------------------------------------------------------------------------

  /**
   * Creates a Site, its seven opening-hour rows, and its system in_transit
   * location atomically (ruling 4/34/56). Defaults are derived from the legal
   * entity's country (AT → Europe/Vienna + AT; DE → Europe/Berlin + DE) unless
   * the DTO overrides them. No default LOT is created for new sites (a LOT is
   * only a MAIN-backfill default when the tenant has none) so a pristine
   * created site remains hard-deletable.
   */
  async createSite(dto: CreateSiteDto) {
    assertTenantAdmin(this.tenantContext);
    const tenantId = await this.tenantContext.getTenantId();

    // POST /api/sites → 422 unless the legal entity is active (ruling 4)
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
      // Serialize site creation with legal-entity deactivation. The guarded
      // update in updateLegalEntity takes the same row lock before checking sites.
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

    let parentLegalEntityActive: boolean | undefined;
    if (dto.isActive === true && !existing.is_active) {
      const legalEntity = await this.prisma.legalEntity.findFirst({
        where: { tenant_id: tenantId, id: existing.legal_entity_id },
        select: { is_active: true },
      });
      parentLegalEntityActive = legalEntity?.is_active;
    }

    validateSiteUpdateInput(dto, existing, parentLegalEntityActive);

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

  /**
   * Resolves the tenant's default ACTIVE site. Used by services that must
   * stamp site_id but do not have a SiteContext yet (single-site legacy
   * tenants have exactly one active site). Fails when the tenant has no active
   * site so BayService/LocationService/PurchaseService never stamp rows into an
   * inactive target.
   */
  async resolveDefaultSiteId(tenantId: string): Promise<string> {
    const site = await this.prisma.site.findFirst({
      where: { tenant_id: tenantId, is_active: true },
      orderBy: { code: 'asc' },
      select: { id: true },
    });
    if (!site) {
      throw new NotFoundException(
        'No active site exists for this tenant. Create or activate a site before creating site-scoped records.',
      );
    }
    return site.id;
  }

  async resolveDefaultSite(tenantId: string) {
    return this.prisma.site.findFirst({
      where: { tenant_id: tenantId, is_active: true },
      orderBy: { code: 'asc' },
    });
  }

  // ---------------------------------------------------------------------------
  // SiteMembership (delegated to SiteMembershipService)
  // ---------------------------------------------------------------------------

  async listSiteMemberships(siteId: string) {
    return this.membershipService.listSiteMemberships(siteId);
  }

  async addSiteMembership(siteId: string, dto: CreateSiteMembershipDto) {
    return this.membershipService.addSiteMembership(siteId, dto);
  }

  async removeSiteMembership(siteId: string, userId: string) {
    return this.membershipService.removeSiteMembership(siteId, userId);
  }

  // ---------------------------------------------------------------------------
  // Guards
  // ---------------------------------------------------------------------------

  /**
   * Guard: legal entity deactivation is 422 while any site of the entity is
   * still active (ruling 38).
   */
  async guardLegalEntityDeactivation(tenantId: string, legalEntityId: string) {
    return this.legalEntityService.guardLegalEntityDeactivation(
      tenantId,
      legalEntityId,
    );
  }

  /**
   * Guard: site deactivation (ruling 41 will serialize this with every write
   * that creates site-owned work). Currently not exposed via updateSite;
   * kept for the SiteContext follow-up and for e2e coverage of the checks it
   * does implement today (stock qty + parked dealer vehicles).
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
      countParkedVehicles(this.prisma, tenantId, siteId),
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
}
