import {
  projectVehicleListOperationalFields,
  stripWorkshopOrdersVehicleIdentity,
} from '../common/projections/vehicle-entity.projection.js';
import { stripVehicleIdentityResolutionState } from '../vehicle/vehicle-identity.util.js';
import {
  buildHistoryMeta,
  type HistoryPagination,
} from '../common/utils/history-pagination.util.js';
import type { CustomerDetailRecord } from './customer-detail.query.js';

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
  authorizedSiteIds: readonly string[],
) {
  return {
    ...customer,
    vehicles: projectVehicleListOperationalFields(
      customer.vehicles?.map(stripVehicleIdentityResolutionState),
      authorizedSiteIds,
    ),
    workshop_orders: stripWorkshopOrdersVehicleIdentity(
      customer.workshop_orders,
      authorizedSiteIds,
    ),
    workshop_orders_meta: buildHistoryMeta(pagination, counts.workshopOrders),
    invoices_meta: buildHistoryMeta(pagination, counts.invoices),
  };
}
