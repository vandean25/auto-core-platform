import {
  implausibleMeasurement,
  invalidMeasurementPayload,
  unsupportedSchemaVersion,
  unsupportedUnit,
} from './inspection-measurement.errors.js';
import {
  ACP_BRAKE_MEASUREMENT_SCHEMA,
  type BrakeWheelReading,
  type CanonicalBrakeMeasurement,
} from './inspection-measurement.types.js';

const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_REF_LENGTH = 128;
const VIN_LENGTH = 17;
const FORCE_PATTERN = /^\d+(\.\d{1,3})?$/;
const WHEEL_SLOTS = [
  { axle: 1 as const, side: 'LEFT' as const },
  { axle: 1 as const, side: 'RIGHT' as const },
  { axle: 2 as const, side: 'LEFT' as const },
  { axle: 2 as const, side: 'RIGHT' as const },
];

function assertBoundedString(
  value: unknown,
  field: string,
  max = MAX_REF_LENGTH,
): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw invalidMeasurementPayload(`${field} is invalid`);
  }
  return value;
}

function parseWheel(value: unknown): BrakeWheelReading {
  if (!value || typeof value !== 'object' || Array.isArray(value)) {
    throw invalidMeasurementPayload('wheel entry is invalid');
  }
  const row = value as Record<string, unknown>;
  const axle = row.axle;
  const side = row.side;
  if (axle !== 1 && axle !== 2) {
    throw invalidMeasurementPayload('wheel.axle is invalid');
  }
  if (side !== 'LEFT' && side !== 'RIGHT') {
    throw invalidMeasurementPayload('wheel.side is invalid');
  }
  const force = assertBoundedString(row.force, 'wheel.force', 32);
  if (!FORCE_PATTERN.test(force)) {
    throw invalidMeasurementPayload('wheel.force format is invalid');
  }
  const unit = assertBoundedString(row.unit, 'wheel.unit', 8);
  if (unit !== 'kN') {
    throw unsupportedUnit();
  }
  return { axle, side, force, unit: 'kN' };
}

export function parseCanonicalBrakeMeasurementUtf8(
  utf8: string,
): CanonicalBrakeMeasurement {
  if (Buffer.byteLength(utf8, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw invalidMeasurementPayload('payload too large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8);
  } catch {
    throw invalidMeasurementPayload('malformed JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidMeasurementPayload('expected object');
  }
  const body = parsed as Record<string, unknown>;
  const keys = Object.keys(body);
  if (keys.some((key, index) => keys.indexOf(key) !== index)) {
    throw invalidMeasurementPayload('duplicate JSON keys');
  }
  for (const key of keys) {
    if (!/^[a-z0-9_]+$/.test(key)) {
      throw invalidMeasurementPayload('unknown property');
    }
  }

  const schemaVersion = assertBoundedString(
    body.schema_version,
    'schema_version',
    64,
  );
  if (schemaVersion !== ACP_BRAKE_MEASUREMENT_SCHEMA) {
    throw unsupportedSchemaVersion();
  }

  const nativeSchemaVersion = assertBoundedString(
    body.native_schema_version,
    'native_schema_version',
    64,
  );

  const sourceSystem = assertBoundedString(body.source_system, 'source_system');
  if (sourceSystem !== 'WORKSHOP_NET') {
    throw invalidMeasurementPayload('source_system is invalid');
  }

  const wheelsRaw = body.wheels;
  if (!Array.isArray(wheelsRaw) || wheelsRaw.length !== 4) {
    throw invalidMeasurementPayload('wheels must contain four readings');
  }
  const wheels = wheelsRaw.map(parseWheel);
  for (const slot of WHEEL_SLOTS) {
    const matches = wheels.filter(
      (wheel) => wheel.axle === slot.axle && wheel.side === slot.side,
    );
    if (matches.length !== 1) {
      throw invalidMeasurementPayload('wheels must cover each axle side once');
    }
  }

  const deviceRangeRaw = body.device_range;
  if (
    !deviceRangeRaw ||
    typeof deviceRangeRaw !== 'object' ||
    Array.isArray(deviceRangeRaw)
  ) {
    throw invalidMeasurementPayload('device_range is required');
  }
  const deviceRangeObj = deviceRangeRaw as Record<string, unknown>;
  const rangeUnit = assertBoundedString(deviceRangeObj.unit, 'device_range.unit');
  if (rangeUnit !== 'kN') {
    throw unsupportedUnit();
  }
  const rangeMin = assertBoundedString(deviceRangeObj.min, 'device_range.min', 32);
  const rangeMax = assertBoundedString(deviceRangeObj.max, 'device_range.max', 32);
  if (!FORCE_PATTERN.test(rangeMin) || !FORCE_PATTERN.test(rangeMax)) {
    throw invalidMeasurementPayload('device_range bounds are invalid');
  }

  const testKind = assertBoundedString(body.test_kind, 'test_kind', 32);
  if (testKind !== 'SERVICE_BRAKE') {
    throw invalidMeasurementPayload('test_kind is invalid');
  }

  const finality = assertBoundedString(body.finality, 'finality', 16);
  if (!['FINAL', 'DRAFT', 'PARTIAL', 'UNKNOWN'].includes(finality)) {
    throw invalidMeasurementPayload('finality is invalid');
  }

  const vin = assertBoundedString(body.vehicle_vin, 'vehicle_vin', VIN_LENGTH)
    .trim()
    .toUpperCase();
  if (vin.length !== VIN_LENGTH) {
    throw invalidMeasurementPayload('vehicle_vin length is invalid');
  }

  const measuredAt = assertBoundedString(body.measured_at, 'measured_at', 40);
  if (Number.isNaN(Date.parse(measuredAt))) {
    throw invalidMeasurementPayload('measured_at is invalid');
  }

  assertBoundedString(body.received_at, 'received_at', 40);

  const previousRefRaw = body.previous_measurement_ref;
  const previous_measurement_ref =
    previousRefRaw === null || previousRefRaw === undefined
      ? null
      : assertBoundedString(previousRefRaw, 'previous_measurement_ref');

  const profile_digest =
    body.profile_digest === undefined || body.profile_digest === null
      ? undefined
      : assertBoundedString(body.profile_digest, 'profile_digest', 64);

  const measurement: CanonicalBrakeMeasurement = {
    schema_version: ACP_BRAKE_MEASUREMENT_SCHEMA,
    native_schema_version: nativeSchemaVersion,
    profile_digest,
    source_system: 'WORKSHOP_NET',
    source_instance_id: assertBoundedString(
      body.source_instance_id,
      'source_instance_id',
    ),
    measurement_id: assertBoundedString(body.measurement_id, 'measurement_id'),
    revision: assertBoundedString(body.revision, 'revision'),
    previous_measurement_ref,
    device_serial: assertBoundedString(body.device_serial, 'device_serial'),
    device_model: assertBoundedString(body.device_model, 'device_model'),
    device_software_version: assertBoundedString(
      body.device_software_version,
      'device_software_version',
    ),
    vehicle_vin: vin,
    workshop_order_ref: assertBoundedString(
      body.workshop_order_ref,
      'workshop_order_ref',
    ),
    session_ref: assertBoundedString(body.session_ref, 'session_ref'),
    measured_at: measuredAt,
    received_at: assertBoundedString(body.received_at, 'received_at'),
    finality: finality as CanonicalBrakeMeasurement['finality'],
    test_kind: 'SERVICE_BRAKE',
    wheels,
    device_range: { min: rangeMin, max: rangeMax, unit: 'kN' },
    device_evidence_ref: assertBoundedString(
      body.device_evidence_ref,
      'device_evidence_ref',
    ),
    native_result_ref: assertBoundedString(
      body.native_result_ref,
      'native_result_ref',
    ),
  };

  if (body.raw_sha256 !== undefined) {
    measurement.raw_sha256 = assertBoundedString(body.raw_sha256, 'raw_sha256', 64);
  }
  if (body.canonical_sha256 !== undefined) {
    measurement.canonical_sha256 = assertBoundedString(
      body.canonical_sha256,
      'canonical_sha256',
      64,
    );
  }

  return measurement;
}

export function assertForcesWithinDeviceRange(
  measurement: CanonicalBrakeMeasurement,
  rangeMin: string,
  rangeMax: string,
): void {
  const min = Number(rangeMin);
  const max = Number(rangeMax);
  for (const wheel of measurement.wheels) {
    const force = Number(wheel.force);
    if (force < min || force > max) {
      throw implausibleMeasurement();
    }
  }
}

export function measuredAtInstant(measuredAt: string): Date {
  return new Date(measuredAt);
}
