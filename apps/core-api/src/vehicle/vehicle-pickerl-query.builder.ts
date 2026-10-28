import type { Prisma } from '@prisma/client';
import type {
  PickerlDueListExportQueryDto,
  PickerlDueListQueryDto,
} from './dto/pickerl-due-list.dto.js';
import {
  compareUtcDates,
  endOfMonthUtc,
  parseYearMonthString,
} from './pickerl/pickerl-date.util.js';

export type VehiclePickerlQuery =
  PickerlDueListQueryDto | PickerlDueListExportQueryDto;

export interface VehiclePickerlDueSummary {
  status: string;
  due_month?: string | null;
}

export class VehiclePickerlQueryBuilder {
  static readonly DEFAULT_PAGE_SIZE = 25;
  /** Larger requests are clamped, not rejected (AUT-807), as on the vehicle list. */
  static readonly MAX_PAGE_SIZE = 50;

  static buildCustomerWhere(
    tenantId: string,
    query: VehiclePickerlQuery,
    today: Date,
  ): { where: Prisma.VehicleWhereInput; windowEndDate: Date | null } {
    const windowEndDate = this.resolveWindowEnd(query, today);
    const where: Prisma.VehicleWhereInput = {
      tenant_id: tenantId,
      inventory_role: 'CUSTOMER',
    };

    if (query.window && windowEndDate) {
      where.OR = this.buildWindowBranches(query, today, windowEndDate);
    }

    return { where, windowEndDate };
  }

  static isWithinWindow(
    pickerlDue: VehiclePickerlDueSummary,
    query: VehiclePickerlQuery,
    windowEndDate: Date | null,
  ): boolean {
    if (query.status && pickerlDue.status !== query.status) {
      return false;
    }

    if (!query.window || !windowEndDate) {
      return true;
    }

    // OVERDUE is always included when filtering by any window.
    if (pickerlDue.status === 'OVERDUE') {
      return true;
    }

    if (!pickerlDue.due_month) {
      return query.status === 'UNKNOWN';
    }

    const dueMonthEnd = endOfMonthUtc(
      parseYearMonthString(pickerlDue.due_month),
    );
    return compareUtcDates(dueMonthEnd, windowEndDate) <= 0;
  }

  /** Sort: OVERDUE first, then by due_month ascending, then UNKNOWN. */
  static compareRows(
    left: { pickerl_due: VehiclePickerlDueSummary },
    right: { pickerl_due: VehiclePickerlDueSummary },
  ): number {
    const rankDiff =
      rankPickerlStatus(left.pickerl_due.status) -
      rankPickerlStatus(right.pickerl_due.status);
    if (rankDiff !== 0) return rankDiff;

    const leftMonth = left.pickerl_due.due_month || '9999-99';
    const rightMonth = right.pickerl_due.due_month || '9999-99';
    return leftMonth.localeCompare(rightMonth);
  }

  static resolvePage(query: { page?: number; pageSize?: number }) {
    const page = query.page && query.page > 0 ? query.page : 1;
    const requestedSize =
      query.pageSize && query.pageSize > 0
        ? query.pageSize
        : VehiclePickerlQueryBuilder.DEFAULT_PAGE_SIZE;
    const pageSize = Math.min(
      requestedSize,
      VehiclePickerlQueryBuilder.MAX_PAGE_SIZE,
    );

    return { page, pageSize, skip: (page - 1) * pageSize };
  }

  private static resolveWindowEnd(
    query: VehiclePickerlQuery,
    today: Date,
  ): Date | null {
    if (!query.window) {
      return null;
    }

    return new Date(
      Date.UTC(
        today.getUTCFullYear(),
        today.getUTCMonth(),
        today.getUTCDate() + query.window,
        23,
        59,
        59,
        999,
      ),
    );
  }

  private static buildWindowBranches(
    query: VehiclePickerlQuery,
    today: Date,
    windowEndDate: Date,
  ): Prisma.VehicleWhereInput[] {
    const branches: Prisma.VehicleWhereInput[] = [
      {
        inspection_records: {
          some: validUntilBeforeMonth(
            today.getUTCFullYear(),
            today.getUTCMonth() + 1,
          ),
        },
      },
      {
        inspection_records: {
          some: validUntilOnOrBeforeMonth(
            windowEndDate.getUTCFullYear(),
            windowEndDate.getUTCMonth() + 1,
          ),
        },
      },
    ];

    if (query.status === 'UNKNOWN') {
      branches.push({ inspection_records: { none: {} } });
    }

    return branches;
  }
}

function rankPickerlStatus(status: string): number {
  return status === 'OVERDUE'
    ? 1
    : status === 'DUE_SOON'
      ? 2
      : status === 'OK'
        ? 3
        : 4;
}

function validUntilOnOrBeforeMonth(year: number, month: number) {
  return {
    OR: [
      { plaketten_valid_until_year: { lt: year } },
      {
        AND: [
          { plaketten_valid_until_year: year },
          { plaketten_valid_until_month: { lte: month } },
        ],
      },
    ],
  };
}

function validUntilBeforeMonth(year: number, month: number) {
  return {
    OR: [
      { plaketten_valid_until_year: { lt: year } },
      {
        AND: [
          { plaketten_valid_until_year: year },
          { plaketten_valid_until_month: { lt: month } },
        ],
      },
    ],
  };
}
