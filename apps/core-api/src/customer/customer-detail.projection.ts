import type { Prisma } from '@prisma/client';
import {
  stripVehicleListIdentity,
  stripWorkshopOrdersVehicleIdentity,
} from '../common/projections/vehicle-entity.projection';
import {
  buildHistoryMeta,
  type HistoryPagination,
} from '../common/utils/history-pagination.util';
import { buildCustomerDetailInclude } from './customer-detail.query';

export type CustomerDetailRecord = Prisma.CustomerGetPayload<{
  include: ReturnType<typeof buildCustomerDetailInclude>;
}>;

export interface CustomerDetailCounts {
  workshopOrders: number;
  invoices: number;
}

export function projectCustomerDetail(
  customer: CustomerDetailRecord,
  pagination: HistoryPagination,
  counts: CustomerDetailCounts,
) {
  return {
    ...customer,
    vehicles: stripVehicleListIdentity(customer.vehicles),
    workshop_orders: stripWorkshopOrdersVehicleIdentity(
      customer.workshop_orders,
    ),
    workshop_orders_meta: buildHistoryMeta(pagination, counts.workshopOrders),
    invoices_meta: buildHistoryMeta(pagination, counts.invoices),
  };
}
