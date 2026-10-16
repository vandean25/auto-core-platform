import {
  BadRequestException,
  ForbiddenException,
  Injectable,
  NotFoundException,
  UnprocessableEntityException,
} from '@nestjs/common';
import { CreditNoteStatus, InvoiceStatus, Prisma } from '@prisma/client';
import { PrismaService } from '../prisma/prisma.service.js';
import { UpdateFinanceSettingsDto } from './dto/update-finance-settings.dto.js';
import { CreateRevenueGroupDto } from './dto/create-revenue-group.dto.js';
import { TenantContextService } from '../common/services/tenant-context.service.js';
import { SiteContextService } from '../site/site-context.service.js';
import { localDateStartUtc } from '../workshop/workshop-kpi-reports.math.js';
import {
  aggregateRevenueReport,
  legacyAnalyticsByGroup,
  type RevenueCreditNoteRow,
  type RevenueInvoiceRow,
} from './finance-revenue-report.aggregate.js';
import {
  addCalendarDays,
  assertIsoDate,
  inclusiveDayCount,
  previousPeriodOfSameLength,
  serverLocalMonthBounds,
} from './finance-revenue-report.period.js';
import type { RevenueReportResult } from './finance-revenue-report.types.js';

const MAX_REPORT_DAYS = 366;
const FINAL_INVOICE_STATUSES = [
  InvoiceStatus.FINALIZED,
  InvoiceStatus.ISSUED,
  InvoiceStatus.PAID,
];

export type GetRevenueReportParams = {
  from: string;
  to: string;
  site_id?: string;
  compare_previous?: boolean;
  /** When true, finalized credit notes in the period are subtracted. Default true. */
  subtract_credit_notes?: boolean;
  /** Site-scoped (default) or tenant-wide across all sites. */
  scope?: 'site' | 'tenant';
  enforce_report_role?: boolean;
};

@Injectable()
export class FinanceService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
    private readonly siteContext: SiteContextService,
  ) {}

  async getSettings() {
    const tenantId = await this.tenantContext.getTenantId();
    const currentYear = new Date().getFullYear();
    return this.prisma.financeSettings.upsert({
      where: { tenant_id: tenantId },
      update: {},
      create: {
        tenant_id: tenantId,
        fiscal_year_start_month: 1,
        lock_date: null,
        next_invoice_number: 1001,
        invoice_prefix: `RE-${currentYear}-`,
        next_sales_order_number: 1001,
        sales_order_prefix: `SO-${currentYear}-`,
        next_workshop_order_number: 1,
        workshop_order_prefix: `WO-${currentYear}-`,
      },
    });
  }

  async updateSettings(data: UpdateFinanceSettingsDto) {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.financeSettings.update({
      where: { tenant_id: tenantId },
      data: {
        ...data,
        lock_date: data.lock_date ? new Date(data.lock_date) : null,
      },
    });
  }

  /**
   * Validates if a transaction date is allowed.
   * Transactions occurring on or before the lock_date are blocked.
   */
  async validateTransactionDate(date: Date, tx?: Prisma.TransactionClient) {
    const tenantId = await this.tenantContext.getTenantId();
    const db = tx ?? this.prisma;
    const settings = await db.financeSettings.findFirst({
      where: { tenant_id: tenantId },
      select: { lock_date: true },
    });
    if (settings?.lock_date && date <= settings.lock_date) {
      throw new UnprocessableEntityException({
        code: 'FISCAL_PERIOD_LOCKED',
        message: `Transaction date ${date.toISOString()} is in a locked fiscal period.`,
        lockDate: settings.lock_date.toISOString(),
      });
    }
  }

  async getRevenueGroups() {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.revenueGroup.findMany({
      where: { tenant_id: tenantId },
      orderBy: { id: 'asc' },
    });
  }

  async createRevenueGroup(data: CreateRevenueGroupDto) {
    const tenantId = await this.tenantContext.getTenantId();
    return this.prisma.revenueGroup.create({
      data: {
        tenant_id: tenantId,
        ...data,
        tax_rate: new Prisma.Decimal(data.tax_rate),
      },
    });
  }

  async getRevenueAnalytics() {
    const tenantId = await this.tenantContext.getTenantId();
    const { from, to, periodLabel } = serverLocalMonthBounds();
    const start = new Date(
      Number(from.slice(0, 4)),
      Number(from.slice(5, 7)) - 1,
      Number(from.slice(8, 10)),
    );
    const end = new Date(
      Number(to.slice(0, 4)),
      Number(to.slice(5, 7)) - 1,
      Number(to.slice(8, 10)) + 1,
    );
    const invoices = await this.loadRevenueInvoices({
      tenantId,
      invoiceDate: { gte: start, lt: end },
    });
    const revenueByGroup = legacyAnalyticsByGroup(invoices);
    const data = [...revenueByGroup.entries()].map(([name, value]) => ({
      name,
      value: Number(value),
      color: this.getGroupColor(name),
    }));
    const total = data.reduce((sum, slice) => sum + slice.value, 0);
    return {
      data,
      total,
      period: periodLabel,
    };
  }

  async getRevenueReport(
    params: GetRevenueReportParams,
  ): Promise<RevenueReportResult> {
    if (params.enforce_report_role !== false) {
      this.assertRevenueReportRole();
    }
    this.validateReportPeriod(params.from, params.to);
    const tenantId = await this.tenantContext.getTenantId();
    const scope = params.scope ?? 'site';
    const subtractCreditNotes = params.subtract_credit_notes ?? true;
    const { siteId, timezone, range } = await this.resolveReportScope(
      tenantId,
      params,
      scope,
    );
    const core = await this.buildRevenueReportCore({
      tenantId,
      siteId,
      timezone,
      from: params.from,
      to: params.to,
      range,
      subtractCreditNotes,
    });
    if (!params.compare_previous) {
      return core;
    }
    const previous = previousPeriodOfSameLength(params.from, params.to);
    const previousScope = await this.resolveReportScope(
      tenantId,
      { ...params, from: previous.from, to: previous.to },
      scope,
    );
    return {
      ...core,
      previous: await this.buildRevenueReportCore({
        tenantId,
        siteId: previousScope.siteId,
        timezone: previousScope.timezone,
        from: previous.from,
        to: previous.to,
        range: previousScope.range,
        subtractCreditNotes,
      }),
    };
  }

  private async resolveReportScope(
    tenantId: string,
    params: GetRevenueReportParams,
    scope: 'site' | 'tenant',
  ): Promise<{
    siteId: string | null;
    timezone: string;
    range: {
      start: Date;
      end: Date;
      creditFrom: Date;
      creditTo: Date;
    };
  }> {
    if (scope === 'tenant') {
      const start = new Date(
        Number(params.from.slice(0, 4)),
        Number(params.from.slice(5, 7)) - 1,
        Number(params.from.slice(8, 10)),
      );
      const end = new Date(
        Number(params.to.slice(0, 4)),
        Number(params.to.slice(5, 7)) - 1,
        Number(params.to.slice(8, 10)) + 1,
      );
      const creditFrom = new Date(`${params.from}T00:00:00.000Z`);
      const creditTo = new Date(`${params.to}T00:00:00.000Z`);
      return {
        siteId: null,
        timezone: 'UTC',
        range: { start, end, creditFrom, creditTo },
      };
    }
    const { siteId, timezone } = await this.resolveReportSite(
      tenantId,
      params.site_id,
    );
    return {
      siteId,
      timezone,
      range: this.siteLocalInvoiceRange(params.from, params.to, timezone),
    };
  }

  private assertRevenueReportRole(): void {
    const role = this.tenantContext.getAuthenticatedUser()?.role?.toUpperCase();
    if (!role || !['OWNER', 'ADMIN', 'SALES'].includes(role)) {
      throw new ForbiddenException(
        'Revenue reports are not available for this role',
      );
    }
  }

  private validateReportPeriod(from: string, to: string): void {
    try {
      assertIsoDate(from, 'from');
      assertIsoDate(to, 'to');
    } catch (error) {
      throw new BadRequestException(
        error instanceof Error ? error.message : 'Invalid report period',
      );
    }
    if (from > to) {
      throw new BadRequestException('from must be on or before to');
    }
    if (inclusiveDayCount(from, to) > MAX_REPORT_DAYS) {
      throw new BadRequestException(
        `Revenue report range cannot exceed ${MAX_REPORT_DAYS} calendar days`,
      );
    }
  }

  private async resolveReportSite(
    tenantId: string,
    siteId?: string,
  ): Promise<{ siteId: string; timezone: string }> {
    const resolvedSiteId = siteId ?? (await this.siteContext.getSiteId());
    const authorizedSiteIds = await this.siteContext.listAuthorizedSiteIds();
    if (!authorizedSiteIds.includes(resolvedSiteId)) {
      throw new NotFoundException('Revenue report site not found');
    }
    const site = await this.prisma.site.findFirst({
      where: { id: resolvedSiteId, tenant_id: tenantId, is_active: true },
      select: { id: true, timezone: true },
    });
    if (!site) {
      throw new NotFoundException('Revenue report site not found');
    }
    return { siteId: site.id, timezone: site.timezone };
  }

  private siteLocalInvoiceRange(
    from: string,
    to: string,
    timezone: string,
  ): { start: Date; end: Date; creditFrom: Date; creditTo: Date } {
    const start = localDateStartUtc(from, timezone);
    const end = localDateStartUtc(addCalendarDays(to, 1), timezone);
    const creditFrom = new Date(`${from}T00:00:00.000Z`);
    const creditTo = new Date(`${to}T00:00:00.000Z`);
    return { start, end, creditFrom, creditTo };
  }

  private async buildRevenueReportCore(input: {
    tenantId: string;
    siteId: string | null;
    timezone: string;
    from: string;
    to: string;
    subtractCreditNotes: boolean;
    range: {
      start: Date;
      end: Date;
      creditFrom: Date;
      creditTo: Date;
    };
  }) {
    const [invoices, creditNotes] = await Promise.all([
      this.loadRevenueInvoices({
        tenantId: input.tenantId,
        siteId: input.siteId ?? undefined,
        invoiceDate: { gte: input.range.start, lt: input.range.end },
      }),
      input.subtractCreditNotes && input.siteId
        ? this.loadRevenueCreditNotes({
            tenantId: input.tenantId,
            siteId: input.siteId,
            creditDate: {
              gte: input.range.creditFrom,
              lte: input.range.creditTo,
            },
          })
        : Promise.resolve([]),
    ]);
    return aggregateRevenueReport({
      period: { from: input.from, to: input.to, timezone: input.timezone },
      site_id: input.siteId,
      invoices,
      creditNotes,
    });
  }

  private async loadRevenueInvoices(input: {
    tenantId: string;
    siteId?: string;
    invoiceDate: { gte: Date; lt?: Date };
  }): Promise<RevenueInvoiceRow[]> {
    return this.prisma.invoice.findMany({
      where: {
        tenant_id: input.tenantId,
        ...(input.siteId ? { site_id: input.siteId } : {}),
        status: { in: FINAL_INVOICE_STATUSES },
        date: input.invoiceDate,
      },
      select: {
        id: true,
        tax_mode: true,
        workshop_order_id: true,
        vehicle_sale_id: true,
        global_discount_type: true,
        global_discount_value: true,
        total_net: true,
        total_tax: true,
        total_gross: true,
        items: {
          where: { tenant_id: input.tenantId },
          select: {
            id: true,
            revenue_group_name: true,
            quantity: true,
            unit_price: true,
            line_total: true,
            line_discount_type: true,
            line_discount_value: true,
            tax_rate: true,
          },
          orderBy: { id: 'asc' },
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  private async loadRevenueCreditNotes(input: {
    tenantId: string;
    siteId: string;
    creditDate: { gte: Date; lte: Date };
  }): Promise<RevenueCreditNoteRow[]> {
    return this.prisma.creditNote.findMany({
      where: {
        tenant_id: input.tenantId,
        site_id: input.siteId,
        status: CreditNoteStatus.FINALIZED,
        date: input.creditDate,
      },
      select: {
        id: true,
        total_net: true,
        total_tax: true,
        total_gross: true,
        snapshot: true,
        original_invoice: {
          select: {
            workshop_order_id: true,
            vehicle_sale_id: true,
            tax_mode: true,
            total_tax: true,
          },
        },
        items: {
          where: { tenant_id: input.tenantId },
          select: {
            snapshot: true,
            original_invoice_item: {
              select: { revenue_group_name: true },
            },
          },
        },
      },
      orderBy: { id: 'asc' },
    });
  }

  private getGroupColor(name: string) {
    if (name.includes('Parts')) return '#3b82f6'; // Blue
    if (name.includes('Labor') || name.includes('Services')) return '#22c55e'; // Green
    return '#94a3b8'; // Slate
  }
}
