import type { Prisma } from '@prisma/client';
import {
  invoicesHistorySlice,
  salesOrdersHistorySlice,
  workshopOrdersHistorySlice,
} from '../common/queries/entity-history.query';
import type { HistoryPagination } from '../common/utils/history-pagination.util';

export function buildCustomerDetailInclude(
  pagination: HistoryPagination,
): Prisma.CustomerInclude {
  const slice = { skip: pagination.skip, take: pagination.limit };

  return {
    vehicles: true,
    sales_orders: salesOrdersHistorySlice(slice),
    workshop_orders: workshopOrdersHistorySlice('customer-detail', slice),
    invoices: invoicesHistorySlice(slice),
  };
}
