import { Injectable, NotFoundException } from '@nestjs/common';
import { TenantContextService } from '../../common/services/tenant-context.service.js';
import { PrismaService } from '../../prisma/prisma.service.js';
import {
  assertTenantAdmin,
  requireActiveCurrentUser,
} from '../../site/site.authorization.js';
import {
  loadAccountingExportCandidates,
  loadTenantOwnershipBlockers,
} from './accounting-export-candidates.js';
import {
  buildAccountingExportReadiness,
  type AccountingExportReadinessView,
} from './accounting-export-readiness.js';
import {
  assertValidExportDateRange,
  isExportPeriodClosed,
} from './accounting-export-period.js';
import { allocationRulesForProfile } from './accounting-export-allocation-rules.js';
import { exportProfileCanGenerate } from './accounting-export-serializer.registry.js';
import {
  assertCompleteAccountingExportScope,
  listAccountingExportSites,
} from './accounting-export-scope.js';
import type { AccountingExportDocumentKind } from './accounting-export.types.js';
import type { AccountingExportReadinessQueryDto } from './dto/accounting-export-readiness.dto.js';

const DOCUMENT_PAGE_PATH: Record<AccountingExportDocumentKind, string> = {
  INVOICE: '/sales/invoices/:id',
  CREDIT_NOTE: '/finance/credit-notes/:id',
};

const DEFAULT_PAGE_SIZE = 25;

export type AccountingExportReadinessResponse =
  AccountingExportReadinessView & {
    legalEntityId: string;
    dateFrom: string;
    dateTo: string;
    periodClosed: boolean;
    lockDate: string | null;
    exportProfile: { configured: boolean; canGenerate: boolean };
  };

type PeriodSettings = Awaited<ReturnType<typeof loadPeriodSettings>>;

@Injectable()
export class AccountingExportReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // Same authorization as export preview and generation: tenant admin, an
  // active user, and an active site membership for every contributing site.
  // Unlike preview, an open period or a missing or disabled profile is not
  // refused. periodClosed and exportProfile report what preview would refuse.
  async getReadiness(
    query: AccountingExportReadinessQueryDto,
  ): Promise<AccountingExportReadinessResponse> {
    const tenantId = await this.tenantContext.getTenantId();
    assertTenantAdmin(this.tenantContext);
    const currentUser = await requireActiveCurrentUser(
      this.prisma,
      this.tenantContext,
      tenantId,
    );
    await assertLegalEntity(this.prisma, tenantId, query.legalEntityId);

    const settings = await loadPeriodSettings(
      this.prisma,
      tenantId,
      query.legalEntityId,
    );
    const { dateFrom, dateTo } = assertValidExportDateRange(
      query.dateFrom,
      query.dateTo,
      settings.profile?.fiscal_year_start_month ??
        settings.fiscal_year_start_month ??
        1,
    );

    const sites = await listAccountingExportSites(
      this.prisma,
      tenantId,
      query.legalEntityId,
      dateFrom,
      dateTo,
    );
    await assertCompleteAccountingExportScope(
      this.prisma,
      tenantId,
      currentUser.id,
      sites,
    );

    const authorizedSiteIds = await loadAuthorizedSiteIds(
      this.prisma,
      tenantId,
      currentUser.id,
    );
    const [candidates, ownershipBlockers] = await Promise.all([
      loadAccountingExportCandidates(
        this.prisma,
        tenantId,
        query.legalEntityId,
        dateFrom,
        dateTo,
        allocationRulesForProfile(
          settings.profile?.profile_code ?? null,
          settings.profile?.serializer_params,
        ),
      ),
      loadTenantOwnershipBlockers(
        this.prisma,
        tenantId,
        dateFrom,
        dateTo,
        authorizedSiteIds,
      ),
    ]);

    const view = buildAccountingExportReadiness({
      candidates,
      ownershipBlockers,
      sites,
      filters: {
        reason: query.reason,
        documentKind: query.documentKind,
        search: query.search,
      },
      sortField: query.sortField,
      sortDirection: query.sortDirection,
      page: query.page ?? 1,
      limit: query.limit ?? DEFAULT_PAGE_SIZE,
      hrefFor: (kind, id) => DOCUMENT_PAGE_PATH[kind].replace(':id', id),
    });

    return toReadinessResponse(view, {
      legalEntityId: query.legalEntityId,
      dateFrom,
      dateTo,
      settings,
    });
  }
}

async function assertLegalEntity(
  prisma: PrismaService,
  tenantId: string,
  legalEntityId: string,
): Promise<void> {
  const entity = await prisma.legalEntity.findFirst({
    where: { id: legalEntityId, tenant_id: tenantId },
    select: { id: true },
  });
  if (!entity) {
    throw new NotFoundException('Legal entity not found');
  }
}

async function loadPeriodSettings(
  prisma: PrismaService,
  tenantId: string,
  legalEntityId: string,
) {
  const settings = await prisma.financeSettings.findFirst({
    where: { tenant_id: tenantId },
    select: { lock_date: true, fiscal_year_start_month: true },
  });
  const profile = await prisma.legalEntityAccountingProfile.findFirst({
    where: { tenant_id: tenantId, legal_entity_id: legalEntityId },
    select: {
      fiscal_year_start_month: true,
      profile_code: true,
      is_enabled: true,
      serializer_params: true,
    },
  });
  return {
    lock_date: settings?.lock_date ?? null,
    fiscal_year_start_month: settings?.fiscal_year_start_month,
    profile,
  };
}

async function loadAuthorizedSiteIds(
  prisma: PrismaService,
  tenantId: string,
  userId: string,
): Promise<Set<string>> {
  const memberships = await prisma.siteMembership.findMany({
    where: { tenant_id: tenantId, user_id: userId, is_active: true },
    select: { site_id: true },
  });
  return new Set(memberships.map((membership) => membership.site_id));
}

function toReadinessResponse(
  view: AccountingExportReadinessView,
  period: {
    legalEntityId: string;
    dateFrom: Date;
    dateTo: Date;
    settings: PeriodSettings;
  },
): AccountingExportReadinessResponse {
  const { lock_date: lockDate, profile } = period.settings;

  return {
    ...view,
    legalEntityId: period.legalEntityId,
    dateFrom: period.dateFrom.toISOString().slice(0, 10),
    dateTo: period.dateTo.toISOString().slice(0, 10),
    periodClosed: isExportPeriodClosed(period.dateTo, lockDate),
    lockDate: lockDate ? lockDate.toISOString() : null,
    exportProfile: {
      configured: Boolean(profile),
      canGenerate: profile
        ? exportProfileCanGenerate(profile.profile_code, profile.is_enabled)
        : false,
    },
  };
}
