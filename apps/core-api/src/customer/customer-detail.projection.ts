import {
  projectVehicleListOperationalFields,
  stripWorkshopOrdersVehicleIdentity,
} from '../common/projections/vehicle-entity.projection.js';
import { stripVehicleIdentityResolutionState } from '../vehicle/vehicle-identity.util.js';
import {
  buildHistoryMeta,
  type HistoryPagination,
} from '../common/utils/history-pagination.util.js';
import { viennaIsoDay } from '../vehicle-stock/gewaehrleistung/gewaehrleistung-status.js';
import { toCustomerVehiclePartyResponse } from '../vehicle/vehicle-party-response.mapper.js';
import type { CustomerDetailRecord } from './customer-detail.query.js';

export interface CustomerDetailCounts {
  workshopOrders: number;
  invoices: number;
}

type CustomerDetailProjectionInput = Omit<
  CustomerDetailRecord,
  'vehicles' | 'workshop_orders' | 'vehicle_parties'
> & {
  vehicles?: CustomerDetailRecord['vehicles'];
  vehicle_parties?: CustomerDetailRecord['vehicle_parties'];
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
    vehicle_parties: customer.vehicle_parties?.map((party) =>
      toCustomerVehiclePartyResponse(party, viennaIsoDay(new Date())),
    ),
    workshop_orders_meta: buildHistoryMeta(pagination, counts.workshopOrders),
    invoices_meta: buildHistoryMeta(pagination, counts.invoices),
  };
}
