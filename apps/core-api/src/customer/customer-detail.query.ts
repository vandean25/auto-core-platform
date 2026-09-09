import type { Prisma } from '@prisma/client';
import {
  invoicesHistorySlice,
  salesOrdersHistorySlice,
  workshopOrdersHistorySlice,
} from '../common/queries/entity-history.query';
import type { HistoryPagination } from '../common/utils/history-pagination.util';

export type CustomerDetailRecord = Prisma.CustomerGetPayload<{
  include: {
    vehicles: true;
    sales_orders: true;
    workshop_orders: {
      include: {
        tasks: {
          include: {
            line_items: {
              select: {
                quantity: true;
                unit_price: true;
              };
            };
          };
        };
        vehicle: true;
      };
    };
    invoices: true;
  };
}>;

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
