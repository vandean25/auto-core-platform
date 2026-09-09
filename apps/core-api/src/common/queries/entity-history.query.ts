import type { Prisma } from '@prisma/client';

export interface HistorySliceOptions {
  skip?: number;
  take: number;
}

export function salesOrdersHistorySlice(
  options: HistorySliceOptions,
): Prisma.SalesOrderFindManyArgs {
  return {
    orderBy: { createdAt: 'desc' },
    ...(options.skip !== undefined ? { skip: options.skip } : {}),
    take: options.take,
  };
}

export function invoicesHistorySlice(
  options: HistorySliceOptions,
): Prisma.InvoiceFindManyArgs {
  return {
    orderBy: { date: 'desc' },
    ...(options.skip !== undefined ? { skip: options.skip } : {}),
    take: options.take,
  };
}

export type WorkshopOrderHistoryVariant = 'customer-detail' | 'vehicle-detail';

export function workshopOrdersHistorySlice(
  variant: WorkshopOrderHistoryVariant,
  options: HistorySliceOptions,
): Prisma.WorkshopOrderFindManyArgs {
  const base = {
    orderBy: { createdAt: 'desc' as const },
    ...(options.skip !== undefined ? { skip: options.skip } : {}),
    take: options.take,
  };

  if (variant === 'customer-detail') {
    return {
      ...base,
      include: {
        tasks: {
          include: {
            line_items: {
              select: {
                quantity: true,
                unit_price: true,
              },
            },
          },
        },
        vehicle: true,
      },
    };
  }

  return {
    ...base,
    include: {
      tasks: {
        include: {
          line_items: true,
        },
      },
      invoice: {
        select: {
          id: true,
          invoice_number: true,
          status: true,
        },
      },
    },
  };
}
