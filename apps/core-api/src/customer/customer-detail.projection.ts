import {
  stripVehicleListIdentity,
  stripWorkshopOrdersVehicleIdentity,
} from '../common/projections/vehicle-entity.projection';
import {
  buildHistoryMeta,
  type HistoryPagination,
} from '../common/utils/history-pagination.util';
import type { CustomerDetailRecord } from './customer-detail.query';

export interface CustomerDetailCounts {
  workshopOrders: number;
  invoices: number;
}

type CustomerDetailProjectionInput = Omit<
  CustomerDetailRecord,
  'vehicles' | 'workshop_orders'
> & {
  vehicles?: CustomerDetailRecord['vehicles'];
  workshop_orders?: Array<
    Record<string, unknown> & {
      vehicle?: CustomerDetailRecord['workshop_orders'][number]['vehicle'];
    }
  >;
};

export function projectCustomerDetail(
  customer: CustomerDetailProjectionInput,
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
