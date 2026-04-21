import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';
import { UpdateFinanceSettingsDto } from './dto/update-finance-settings.dto';
import { CreateRevenueGroupDto } from './dto/create-revenue-group.dto';
import { TenantContextService } from '../common/services/tenant-context.service';

@Injectable()
export class FinanceService {
  constructor(
    private prisma: PrismaService,
    private readonly tenantContext: TenantContextService,
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
  async validateTransactionDate(date: Date) {
    const settings = await this.getSettings();
    if (settings.lock_date && date <= settings.lock_date) {
      throw new ForbiddenException(
        `Transaction date ${date.toISOString()} is in a locked fiscal period (Locked up to ${settings.lock_date.toISOString()})`,
      );
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
    const now = new Date();
    const startOfMonth = new Date(now.getFullYear(), now.getMonth(), 1);

    const items = await this.prisma.invoiceItem.findMany({
      where: {
        invoice: {
          tenant_id: tenantId,
          status: { in: ['FINALIZED', 'ISSUED', 'PAID'] },
          date: { gte: startOfMonth },
        },
      },
      select: {
        revenue_group_name: true,
        quantity: true,
        unit_price: true,
      },
    });

    const revenueByGroup: Record<string, number> = {};
    let total = 0;

    items.forEach((item) => {
      const group = item.revenue_group_name || 'Other';
      const value = Number(item.quantity) * Number(item.unit_price);
      revenueByGroup[group] = (revenueByGroup[group] || 0) + value;
      total += value;
    });

    const data = Object.entries(revenueByGroup).map(([name, value]) => ({
      name,
      value,
      color: this.getGroupColor(name),
    }));

    return {
      data,
      total,
      period: now.toISOString().substring(0, 7), // YYYY-MM
    };
  }

  private getGroupColor(name: string) {
    if (name.includes('Parts')) return '#3b82f6'; // Blue
    if (name.includes('Labor') || name.includes('Services')) return '#22c55e'; // Green
    return '#94a3b8'; // Slate
  }
}
