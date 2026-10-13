import {
  projectVehicleListOperationalFields,
  projectVehicleOperationalFields,
} from '../common/projections/vehicle-entity.projection.js';
import { omitKaufvertragArchiveInternals } from '../vehicle-stock/kaufvertrag/kaufvertrag-sale-response.js';
import { attachPickerlDue } from './pickerl/attach-pickerl-due.js';
import { stripVehicleIdentityResolutionState } from './vehicle-identity.util.js';
import type { VehiclePersistenceService } from './vehicle-persistence.service.js';

type VehicleListRow = Awaited<
  ReturnType<VehiclePersistenceService['listVehicles']>
>['rows'][number];

type VehicleDetailRow = NonNullable<
  Awaited<ReturnType<VehiclePersistenceService['findVehicleDetail']>>
>;

export function toVehicleListResponse(input: {
  rows: VehicleListRow[];
  total: number;
  page: number;
  pageSize: number;
  authorizedSiteIds: readonly string[];
}) {
  return {
    data: projectVehicleListOperationalFields(
      input.rows.map(stripVehicleIdentityResolutionState),
      input.authorizedSiteIds,
    ),
    meta: {
      total: input.total,
      page: input.page,
      pageSize: input.pageSize,
      pageCount: Math.ceil(input.total / input.pageSize),
    },
  };
}

export function toVehicleDetailResponse(
  vehicle: VehicleDetailRow,
  authorizedSiteIds: readonly string[],
  onDate: Date,
) {
  const projected = projectVehicleOperationalFields(
    stripVehicleIdentityResolutionState({
      ...vehicle,
      sales: vehicle.sales.map((sale) => omitKaufvertragArchiveInternals(sale)),
    }),
    authorizedSiteIds,
  );

  return attachPickerlDue(projected, onDate);
}
