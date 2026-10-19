import { Injectable, Optional } from '@nestjs/common';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { DashboardRealtimeService } from '../dashboard-realtime/dashboard-realtime.service.js';
import { PrismaService } from '../prisma/prisma.service.js';
import { AccountingProfileService } from '../finance/accounting-profile/accounting-profile.service.js';
import { UpdateAccountingProfileDto } from '../finance/accounting-profile/dto/accounting-profile.dto.js';
import {
  CreateLegalEntityDto,
  CreateSiteDto,
  CreateSiteMembershipDto,
  SetActiveSiteDto,
  UpdateLegalEntityDto,
  UpdateSiteDto,
} from './dto/site.dto.js';
import { LegalEntityService } from './legal-entity.service.js';
import { SiteDefaultsService } from './site-defaults.service.js';
import { SiteDeactivationGuardService } from './site-deactivation-guard.service.js';
import { SiteDirectoryService } from './site-directory.service.js';
import { SiteLifecycleService } from './site-lifecycle.service.js';
import { SiteMembershipService } from './site-membership.service.js';
import { SiteSessionService } from './site-session.service.js';

/** Facade wiring for {@link SiteService}; kept out of site.service.ts for repowise. */
@Injectable()
export class SiteServiceRuntime {
  private readonly directory: SiteDirectoryService;
  private readonly lifecycle: SiteLifecycleService;
  private readonly defaults: SiteDefaultsService;
  private readonly session: SiteSessionService;
  private readonly deactivationGuards: SiteDeactivationGuardService;
  private readonly memberships: SiteMembershipService;
  private readonly legalEntities: LegalEntityService;
  private readonly accountingProfiles: AccountingProfileService;

  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly dashboardRealtime: DashboardRealtimeService,
    @Optional() membershipService?: SiteMembershipService,
    @Optional() legalEntityService?: LegalEntityService,
    @Optional() accountingProfileService?: AccountingProfileService,
  ) {
    this.directory = new SiteDirectoryService(prisma, tenantContext);
    this.lifecycle = new SiteLifecycleService(prisma, tenantContext);
    this.defaults = new SiteDefaultsService(prisma);
    this.session = new SiteSessionService(
      prisma,
      tenantContext,
      dashboardRealtime,
    );
    this.deactivationGuards = new SiteDeactivationGuardService(prisma);
    this.memberships =
      membershipService ??
      new SiteMembershipService(prisma, tenantContext, dashboardRealtime);
    this.legalEntities =
      legalEntityService ?? new LegalEntityService(prisma, tenantContext);
    this.accountingProfiles =
      accountingProfileService ??
      new AccountingProfileService(prisma, tenantContext);
  }

  listLegalEntities(includeInactive = true) {
    return this.legalEntities.listLegalEntities(includeInactive);
  }

  getLegalEntity(id: string) {
    return this.legalEntities.getLegalEntity(id);
  }

  createLegalEntity(dto: CreateLegalEntityDto) {
    return this.legalEntities.createLegalEntity(dto);
  }

  updateLegalEntity(id: string, dto: UpdateLegalEntityDto) {
    return this.legalEntities.updateLegalEntity(id, dto);
  }

  deleteLegalEntity(id: string) {
    return this.legalEntities.deleteLegalEntity(id);
  }

  getAccountingProfile(legalEntityId: string) {
    return this.accountingProfiles.getAccountingProfile(legalEntityId);
  }

  updateAccountingProfile(
    legalEntityId: string,
    dto: UpdateAccountingProfileDto,
  ) {
    return this.accountingProfiles.updateAccountingProfile(legalEntityId, dto);
  }

  listSites(includeInactive = false) {
    return this.directory.listSites(includeInactive);
  }

  getSite(id: string) {
    return this.directory.getSite(id);
  }

  createSite(dto: CreateSiteDto) {
    return this.lifecycle.createSite(dto);
  }

  updateSite(id: string, dto: UpdateSiteDto) {
    return this.lifecycle.updateSite(id, dto);
  }

  deleteSite(id: string) {
    return this.lifecycle.deleteSite(id);
  }

  resolveDefaultSiteId(tenantId: string) {
    return this.defaults.resolveDefaultSiteId(tenantId);
  }

  resolveDefaultSite(tenantId: string) {
    return this.defaults.resolveDefaultSite(tenantId);
  }

  listMySites() {
    return this.session.listMySites();
  }

  setActiveSite(dto: SetActiveSiteDto) {
    return this.session.setActiveSite(dto);
  }

  listSiteMemberships(siteId: string) {
    return this.memberships.listSiteMemberships(siteId);
  }

  addSiteMembership(siteId: string, dto: CreateSiteMembershipDto) {
    return this.memberships.addSiteMembership(siteId, dto);
  }

  removeSiteMembership(siteId: string, userId: string) {
    return this.memberships.removeSiteMembership(siteId, userId);
  }

  guardLegalEntityDeactivation(tenantId: string, legalEntityId: string) {
    return this.legalEntities.guardLegalEntityDeactivation(
      tenantId,
      legalEntityId,
    );
  }

  guardSiteDeactivation(tenantId: string, siteId: string) {
    return this.deactivationGuards.guardSiteDeactivation(tenantId, siteId);
  }
}
