import type { TyreMeasurement, TyreWheelReading } from '@prisma/client';
import type { TyreEvaluation } from './tyre-evaluation.js';
import { worstTyreStatus } from './tyre-evaluation.js';
import type { TyreMeasurementResponseDto } from './tyre-measurement.dto.js';

function toMm(value: TyreWheelReading['tread_inner_mm']): number | null {
  return value === null ? null : Number(value);
}

export function toTyreMeasurementResponse(
  row: TyreMeasurement & { wheels: TyreWheelReading[] },
): TyreMeasurementResponseDto {
  return {
    id: row.id,
    siteId: row.site_id,
    vehicleId: row.vehicle_id,
    workshopOrderId: row.workshop_order_id,
    checkInId: row.check_in_id,
    tyreSetId: row.tyre_set_id,
    tyreSetEventId: row.tyre_set_event_id,
    measuredAt: row.measured_at.toISOString(),
    measuredBy: row.measured_by,
    measuredByName: row.measured_by_name,
    country: row.country,
    weightClass: row.weight_class,
    weightClassSource: row.weight_class_source,
    source: row.source,
    sourceRef: row.source_ref,
    worstStatus: worstTyreStatus(
      row.wheels.map(
        (wheel) => (wheel.evaluation as unknown as TyreEvaluation).status,
      ),
    ),
    createdAt: row.createdAt.toISOString(),
    wheels: row.wheels.map((wheel) => ({
      id: wheel.id,
      position: wheel.position,
      treadInnerMm: toMm(wheel.tread_inner_mm),
      treadMiddleMm: Number(wheel.tread_middle_mm),
      treadOuterMm: toMm(wheel.tread_outer_mm),
      brand: wheel.brand,
      model: wheel.model,
      size: wheel.size,
      dot: wheel.dot,
      season: wheel.season,
      construction: wheel.construction,
      winterMarking: wheel.winter_marking,
      mediaId: wheel.media_id,
      evaluation: wheel.evaluation as unknown as TyreEvaluation,
    })),
  };
}
