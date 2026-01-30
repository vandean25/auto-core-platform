import { Injectable, ForbiddenException } from '@nestjs/common';
import { PrismaService } from '../prisma/prisma.service';
import { Prisma } from '@prisma/client';

@Injectable()
export class FinanceService {
  constructor(private prisma: PrismaService) {}

  async getSettings() {
    return this.prisma.financeSettings.upsert({
      where: { id: 1 },
      update: {},
      create: {
        id: 1,
        fiscal_year_start_month: 1,
        lock_date: null,
        next_invoice_number: 1001,
        invoice_prefix: 'RE-2026-',
      },
    });
  }

  async updateSettings(data: {
    fiscal_year_start_month?: number;
    lock_date?: string | null;
    next_invoice_number?: number;
    invoice_prefix?: string;
  }) {
    return this.prisma.financeSettings.update({
      where: { id: 1 },
      data: {
        ...data,
        lock_date: data.lock_date ? new Date(data.lock_date) : null,
      },
    });
  }

  async validateTransactionDate(date: Date) {
    const settings = await this.getSettings();
    if (settings.lock_date && date <= settings.lock_date) {
      throw new ForbiddenException(
        `Transaction date ${date.toISOString()} is in a locked fiscal period (Locked up to ${settings.lock_date.toISOString()})`,
      );
    }
  }

  async getRevenueGroups() {
    return this.prisma.revenueGroup.findMany({
      orderBy: { id: 'asc' },
    });
  }

  async createRevenueGroup(data: {
    name: string;
    tax_rate: number;
    account_number: string;
    is_default?: boolean;
  }) {
    return this.prisma.revenueGroup.create({
      data: {
        ...data,
        tax_rate: new Prisma.Decimal(data.tax_rate),
      },
    });
  }
}
