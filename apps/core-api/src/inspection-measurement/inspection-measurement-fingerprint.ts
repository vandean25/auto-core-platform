import { createHash } from 'node:crypto';
import type { CanonicalBrakeMeasurement } from './inspection-measurement.types.js';

function sortValue(value: unknown): unknown {
  if (Array.isArray(value)) {
    return value.map(sortValue);
  }
  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = sortValue(record[key]);
        return acc;
      }, {});
  }
  return value;
}

export function semanticDigestForMeasurement(
  measurement: CanonicalBrakeMeasurement,
): string {
  const payload = sortValue({
    schema_version: measurement.schema_version,
    native_schema_version: measurement.native_schema_version,
    source_system: measurement.source_system,
    source_instance_id: measurement.source_instance_id,
    measurement_id: measurement.measurement_id,
    revision: measurement.revision,
    previous_measurement_ref: measurement.previous_measurement_ref,
    device_serial: measurement.device_serial,
    device_model: measurement.device_model,
    device_software_version: measurement.device_software_version,
    vehicle_vin: measurement.vehicle_vin,
    workshop_order_ref: measurement.workshop_order_ref,
    session_ref: measurement.session_ref,
    measured_at: measurement.measured_at,
    finality: measurement.finality,
    test_kind: measurement.test_kind,
    wheels: measurement.wheels,
    device_range: measurement.device_range,
    device_evidence_ref: measurement.device_evidence_ref,
    native_result_ref: measurement.native_result_ref,
  });
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function sha256Utf8(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function previewFingerprint(
  semanticDigest: string,
  deviceBindingRevision: number,
  orderId: string,
  vehicleVin: string,
  sessionRef: string,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        semanticDigest,
        deviceBindingRevision,
        orderId,
        vehicleVin: vehicleVin.trim().toUpperCase(),
        sessionRef,
      }),
    )
    .digest('hex');
}
