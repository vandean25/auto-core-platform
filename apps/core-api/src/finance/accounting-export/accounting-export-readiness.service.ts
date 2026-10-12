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
  };

@Injectable()
export class AccountingExportReadinessService {
  constructor(
    private readonly prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
  ) {}

  // Same authorization as export preview and generation: tenant admin, an
  // active user, and an active site membership for every contributing site.
  // Unlike preview, an open period or a missing profile is reported, not refused.
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

    const entity = await this.prisma.legalEntity.findFirst({
      where: { id: query.legalEntityId, tenant_id: tenantId },
      select: { id: true },
    });
    if (!entity) {
      throw new NotFoundException('Legal entity not found');
    }

    const settings = await this.prisma.financeSettings.findFirst({
      where: { tenant_id: tenantId },
      select: { lock_date: true, fiscal_year_start_month: true },
    });
    const profile = await this.prisma.legalEntityAccountingProfile.findFirst({
      where: { tenant_id: tenantId, legal_entity_id: query.legalEntityId },
      select: { fiscal_year_start_month: true },
    });
    const { dateFrom, dateTo } = assertValidExportDateRange(
      query.dateFrom,
      query.dateTo,
      profile?.fiscal_year_start_month ??
        settings?.fiscal_year_start_month ??
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

    const memberships = await this.prisma.siteMembership.findMany({
      where: { tenant_id: tenantId, user_id: currentUser.id, is_active: true },
      select: { site_id: true },
    });
    const authorizedSiteIds = new Set(
      memberships.map((membership) => membership.site_id),
    );

    const [candidates, ownershipBlockers] = await Promise.all([
      loadAccountingExportCandidates(
        this.prisma,
        tenantId,
        query.legalEntityId,
        dateFrom,
        dateTo,
      ),
      loadTenantOwnershipBlockers(
        this.prisma,
        tenantId,
        dateFrom,
        dateTo,
        authorizedSiteIds,
      ),
    ]);

    const lockDate = settings?.lock_date ?? null;
    const view = buildAccountingExportReadiness({
      candidates,
      ownershipBlockers,
      sites,
      filters: {
        reason: query.reason,
        documentKind: query.documentKind,
        search: query.search,
      },
      page: query.page ?? 1,
      limit: query.limit ?? DEFAULT_PAGE_SIZE,
      hrefFor: (kind, id) => DOCUMENT_PAGE_PATH[kind].replace(':id', id),
    });

    return {
      ...view,
      legalEntityId: query.legalEntityId,
      dateFrom: dateFrom.toISOString().slice(0, 10),
      dateTo: dateTo.toISOString().slice(0, 10),
      periodClosed: isExportPeriodClosed(dateTo, lockDate),
      lockDate: lockDate ? lockDate.toISOString() : null,
    };
  }
}
