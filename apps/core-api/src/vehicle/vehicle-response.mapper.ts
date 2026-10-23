import {
  projectVehicleListOperationalFields,
  projectVehicleOperationalFields,
} from '../common/projections/vehicle-entity.projection.js';
import { viennaIsoDay } from '../vehicle-stock/gewaehrleistung/gewaehrleistung-status.js';
import { omitKaufvertragArchiveInternals } from '../vehicle-stock/kaufvertrag/kaufvertrag-sale-response.js';
import { toGewaehrleistungReadFields } from '../vehicle-stock/vehicle-sale.warranty.js';
import { attachPickerlDue } from './pickerl/attach-pickerl-due.js';
import type { PickerlBarrierFlags } from './pickerl/apply-pickerl-record-selection.js';
import { stripVehicleIdentityResolutionState } from './vehicle-identity.util.js';
import { toPartyResponse } from './vehicle-party-response.mapper.js';
import { dateToDay } from './vehicle-party-date.util.js';
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
  pickerlBarriers?: PickerlBarrierFlags,
) {
  const today = viennaIsoDay(onDate);
  const { parties, notices, ...rest } = vehicle;
  const projected = projectVehicleOperationalFields(
    stripVehicleIdentityResolutionState({
      ...rest,
      sales: vehicle.sales.map((sale) => ({
        ...omitKaufvertragArchiveInternals(sale),
        ...toGewaehrleistungReadFields(sale, today),
      })),
    }),
    authorizedSiteIds,
  );

  return attachPickerlDue(
    {
      ...projected,
      parties: (parties ?? []).map((party) => toPartyResponse(party, today)),
      open_due_dates: (notices ?? []).map((notice) => ({
        id: notice.id,
        title: notice.title,
        due_date: dateToDay(notice.due_date),
        due_mileage: notice.due_mileage,
        external_ref: notice.external_ref,
        source: notice.source,
      })),
      pickerl_barriers: pickerlBarriers,
    },
    onDate,
  );
}
