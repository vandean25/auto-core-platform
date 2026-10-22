import type { Prisma } from '@prisma/client';
import {
  invoicesHistorySlice,
  salesOrdersHistorySlice,
  workshopOrdersHistorySlice,
} from '../common/queries/entity-history.query.js';
import type { HistoryPagination } from '../common/utils/history-pagination.util.js';

export const CUSTOMER_VEHICLE_PARTY_LIMIT = 100;

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
    vehicle_parties: {
      include: {
        vehicle: { select: { id: true; make: true; model: true; plate: true } };
      };
    };
  };
}>;

export function buildCustomerDetailInclude(
  pagination: HistoryPagination,
  authorizedSiteIds: readonly string[],
  tenantId: string,
) {
  const slice = { skip: pagination.skip, take: pagination.limit };

  return {
    vehicles: {
      include: {
        location: true,
        reserved_for_customer: true,
      },
    },
    sales_orders: {
      ...salesOrdersHistorySlice(slice),
      where: { site_id: { in: [...authorizedSiteIds] } },
    },
    workshop_orders: {
      ...workshopOrdersHistorySlice('customer-detail', slice),
      where: { site_id: { in: [...authorizedSiteIds] } },
    },
    invoices: invoicesHistorySlice(slice),
    vehicle_parties: {
      where: { tenant_id: tenantId },
      orderBy: { createdAt: 'desc' },
      take: CUSTOMER_VEHICLE_PARTY_LIMIT,
      include: {
        vehicle: { select: { id: true, make: true, model: true, plate: true } },
      },
    },
  } satisfies Prisma.CustomerInclude;
}
