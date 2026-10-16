import {
  invalidInspectionPayload,
  unsupportedSchemaVersion,
  unsupportedUnit,
} from './inspection-exchange.errors.js';
import {
  ACP_INSPECTION_RESULT_SCHEMA,
  type CanonicalInspectionResult,
} from './inspection-exchange.types.js';

const MAX_PAYLOAD_BYTES = 256 * 1024;
const MAX_REF_LENGTH = 128;
const VIN_LENGTH = 17;

function assertBoundedString(
  value: unknown,
  field: string,
  max = MAX_REF_LENGTH,
): string {
  if (typeof value !== 'string' || value.length === 0 || value.length > max) {
    throw invalidInspectionPayload(`${field} is invalid`);
  }
  return value;
}

function parsePlateValidUntil(
  value: string,
): { year: number; month: number } | null {
  const match = /^(\d{4})-(\d{2})$/.exec(value);
  if (!match) {
    throw invalidInspectionPayload('plate.valid_until is invalid');
  }
  const year = Number(match[1]);
  const month = Number(match[2]);
  if (month < 1 || month > 12) {
    throw invalidInspectionPayload('plate.valid_until month is invalid');
  }
  return { year, month };
}

export function parseCanonicalInspectionResultUtf8(
  utf8: string,
): CanonicalInspectionResult {
  if (Buffer.byteLength(utf8, 'utf8') > MAX_PAYLOAD_BYTES) {
    throw invalidInspectionPayload('payload too large');
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(utf8);
  } catch {
    throw invalidInspectionPayload('malformed JSON');
  }
  if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
    throw invalidInspectionPayload('expected object');
  }
  const body = parsed as Record<string, unknown>;
  if (Object.keys(body).some((key, index, keys) => keys.indexOf(key) !== index)) {
    throw invalidInspectionPayload('duplicate JSON keys');
  }

  const schemaVersion = assertBoundedString(body.schema_version, 'schema_version', 64);
  if (schemaVersion !== ACP_INSPECTION_RESULT_SCHEMA) {
    throw unsupportedSchemaVersion();
  }

  const odometerRaw = body.odometer;
  if (odometerRaw !== undefined && odometerRaw !== null) {
    if (typeof odometerRaw !== 'object' || Array.isArray(odometerRaw)) {
      throw invalidInspectionPayload('odometer is invalid');
    }
    const odometer = odometerRaw as Record<string, unknown>;
    const unit = assertBoundedString(odometer.unit, 'odometer.unit', 8);
    if (unit !== 'km') {
      throw unsupportedUnit();
    }
    const value = assertBoundedString(odometer.value, 'odometer.value', 32);
    if (!/^\d+(\.\d{1,3})?$/.test(value)) {
      throw invalidInspectionPayload('odometer.value is invalid');
    }
  }

  const vehicleRaw = body.vehicle;
  if (!vehicleRaw || typeof vehicleRaw !== 'object' || Array.isArray(vehicleRaw)) {
    throw invalidInspectionPayload('vehicle is required');
  }
  const vehicle = vehicleRaw as Record<string, unknown>;
  const vin = assertBoundedString(vehicle.vin, 'vehicle.vin', VIN_LENGTH)
    .trim()
    .toUpperCase();
  if (vin.length !== VIN_LENGTH) {
    throw invalidInspectionPayload('vehicle.vin length is invalid');
  }
  const firstRegistrationOn = assertBoundedString(
    vehicle.first_registration_on,
    'vehicle.first_registration_on',
    10,
  );
  if (!/^\d{4}-\d{2}-\d{2}$/.test(firstRegistrationOn)) {
    throw invalidInspectionPayload('vehicle.first_registration_on is invalid');
  }

  const plateRaw = body.plate;
  let plate: CanonicalInspectionResult['plate'] = null;
  if (plateRaw !== undefined && plateRaw !== null) {
    if (typeof plateRaw !== 'object' || Array.isArray(plateRaw)) {
      throw invalidInspectionPayload('plate is invalid');
    }
    const plateObj = plateRaw as Record<string, unknown>;
    const validUntil = assertBoundedString(
      plateObj.valid_until,
      'plate.valid_until',
      7,
    );
    parsePlateValidUntil(validUntil);
    plate = {
      number: assertBoundedString(plateObj.number, 'plate.number', 32),
      colour: assertBoundedString(plateObj.colour, 'plate.colour', 32),
      valid_until: validUntil,
    };
  }

  const occurrenceRaw = body.occurrence_relation;
  if (
    !occurrenceRaw ||
    typeof occurrenceRaw !== 'object' ||
    Array.isArray(occurrenceRaw)
  ) {
    throw invalidInspectionPayload('occurrence_relation is required');
  }
  const occurrence = occurrenceRaw as Record<string, unknown>;
  const kind = assertBoundedString(
    occurrence.kind,
    'occurrence_relation.kind',
    32,
  ) as CanonicalInspectionResult['occurrence_relation']['kind'];
  if (!['INITIAL', 'CORRECTION', 'REVOCATION', 'UNKNOWN'].includes(kind)) {
    throw invalidInspectionPayload('occurrence_relation.kind is invalid');
  }

  const acknowledgementRaw = body.acknowledgement;
  if (
    !acknowledgementRaw ||
    typeof acknowledgementRaw !== 'object' ||
    Array.isArray(acknowledgementRaw)
  ) {
    throw invalidInspectionPayload('acknowledgement is required');
  }
  const acknowledgement = acknowledgementRaw as Record<string, unknown>;
  const ackState = assertBoundedString(
    acknowledgement.state,
    'acknowledgement.state',
    32,
  ) as CanonicalInspectionResult['acknowledgement']['state'];

  const outcome = assertBoundedString(body.outcome, 'outcome', 32) as CanonicalInspectionResult['outcome'];
  const finality = assertBoundedString(body.finality, 'finality', 32) as CanonicalInspectionResult['finality'];

  const inspectedAt = assertBoundedString(body.inspected_at, 'inspected_at', 64);
  if (Number.isNaN(Date.parse(inspectedAt))) {
    throw invalidInspectionPayload('inspected_at is invalid');
  }

  const inspectorRaw = body.inspector;
  if (!inspectorRaw || typeof inspectorRaw !== 'object' || Array.isArray(inspectorRaw)) {
    throw invalidInspectionPayload('inspector is required');
  }
  const inspector = inspectorRaw as Record<string, unknown>;

  return {
    schema_version: schemaVersion,
    source_schema_version: assertBoundedString(
      body.source_schema_version,
      'source_schema_version',
      64,
    ),
    source_system: 'EBV',
    source_account_ref: assertBoundedString(
      body.source_account_ref,
      'source_account_ref',
    ),
    source_station_id: assertBoundedString(
      body.source_station_id,
      'source_station_id',
    ),
    source_result_id: assertBoundedString(body.source_result_id, 'source_result_id'),
    source_revision: assertBoundedString(body.source_revision, 'source_revision'),
    zbd_report_id:
      body.zbd_report_id === null || body.zbd_report_id === undefined
        ? null
        : assertBoundedString(body.zbd_report_id, 'zbd_report_id'),
    occurrence_relation: {
      kind,
      predecessor:
        occurrence.predecessor === null || occurrence.predecessor === undefined
          ? null
          : (occurrence.predecessor as Record<string, string>),
      classification_evidence_ref:
        occurrence.classification_evidence_ref === null ||
        occurrence.classification_evidence_ref === undefined
          ? null
          : assertBoundedString(
              occurrence.classification_evidence_ref,
              'classification_evidence_ref',
            ),
    },
    vehicle: {
      vin,
      first_registration_on: firstRegistrationOn,
      registration_plate:
        vehicle.registration_plate === null ||
        vehicle.registration_plate === undefined
          ? null
          : assertBoundedString(
              vehicle.registration_plate,
              'vehicle.registration_plate',
              32,
            ),
    },
    inspected_at: inspectedAt,
    inspector: {
      source_person_id: assertBoundedString(
        inspector.source_person_id,
        'inspector.source_person_id',
      ),
      qualification_evidence_ref:
        inspector.qualification_evidence_ref === null ||
        inspector.qualification_evidence_ref === undefined
          ? null
          : assertBoundedString(
              inspector.qualification_evidence_ref,
              'qualification_evidence_ref',
            ),
    },
    outcome,
    native_outcome_code:
      body.native_outcome_code === null || body.native_outcome_code === undefined
        ? null
        : assertBoundedString(body.native_outcome_code, 'native_outcome_code'),
    plate,
    odometer:
      odometerRaw === undefined || odometerRaw === null
        ? null
        : {
            value: assertBoundedString(
              (odometerRaw as Record<string, unknown>).value,
              'odometer.value',
            ),
            unit: 'km',
          },
    finality,
    acknowledgement: {
      state: ackState,
      evidence_type:
        acknowledgement.evidence_type === null ||
        acknowledgement.evidence_type === undefined
          ? null
          : assertBoundedString(
              acknowledgement.evidence_type,
              'acknowledgement.evidence_type',
              64,
            ),
      evidence_ref:
        acknowledgement.evidence_ref === null ||
        acknowledgement.evidence_ref === undefined
          ? null
          : assertBoundedString(
              acknowledgement.evidence_ref,
              'acknowledgement.evidence_ref',
            ),
    },
  };
}

export function inspectedOnInVienna(inspectedAtIso: string): string {
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Europe/Vienna',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(new Date(inspectedAtIso));
}

export { parsePlateValidUntil };
