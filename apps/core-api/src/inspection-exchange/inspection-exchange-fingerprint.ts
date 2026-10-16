import { createHash } from 'node:crypto';
import type { CanonicalInspectionResult } from './inspection-exchange.types.js';

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

export function semanticDigestForResult(
  result: CanonicalInspectionResult,
): string {
  const payload = sortValue({
    schema_version: result.schema_version,
    source_schema_version: result.source_schema_version,
    source_system: result.source_system,
    source_account_ref: result.source_account_ref,
    source_station_id: result.source_station_id,
    source_result_id: result.source_result_id,
    source_revision: result.source_revision,
    zbd_report_id: result.zbd_report_id,
    occurrence_relation: result.occurrence_relation,
    vehicle: result.vehicle,
    inspected_at: result.inspected_at,
    inspector: result.inspector,
    outcome: result.outcome,
    native_outcome_code: result.native_outcome_code ?? null,
    plate: result.plate,
    odometer: result.odometer ?? null,
    finality: result.finality,
    acknowledgement: {
      state: result.acknowledgement.state,
      evidence_type: result.acknowledgement.evidence_type ?? null,
      evidence_ref: result.acknowledgement.evidence_ref ?? null,
    },
  });
  return createHash('sha256').update(JSON.stringify(payload)).digest('hex');
}

export function sha256Utf8(input: string): string {
  return createHash('sha256').update(input, 'utf8').digest('hex');
}

export function previewFingerprint(
  semanticDigest: string,
  connectionBindingRevision: number,
  vehicleVin: string,
): string {
  return createHash('sha256')
    .update(
      JSON.stringify({
        semanticDigest,
        bindingRevision: connectionBindingRevision,
        vehicleVin: vehicleVin.trim().toUpperCase(),
      }),
    )
    .digest('hex');
}
