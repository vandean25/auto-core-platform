export const ACP_BRAKE_MEASUREMENT_SCHEMA = 'acp-brake-measurement/1';

export type BrakeWheelReading = {
  axle: 1 | 2;
  side: 'LEFT' | 'RIGHT';
  force: string;
  unit: 'kN';
};

export type CanonicalBrakeMeasurement = {
  schema_version: typeof ACP_BRAKE_MEASUREMENT_SCHEMA;
  native_schema_version: string;
  profile_digest?: string;
  source_system: 'WORKSHOP_NET';
  source_instance_id: string;
  measurement_id: string;
  revision: string;
  previous_measurement_ref: string | null;
  device_serial: string;
  device_model: string;
  device_software_version: string;
  vehicle_vin: string;
  workshop_order_ref: string;
  session_ref: string;
  measured_at: string;
  received_at: string;
  finality: 'FINAL' | 'DRAFT' | 'PARTIAL' | 'UNKNOWN';
  test_kind: 'SERVICE_BRAKE';
  wheels: BrakeWheelReading[];
  device_range: { min: string; max: string; unit: 'kN' };
  device_evidence_ref: string;
  native_result_ref: string;
  raw_sha256?: string;
  canonical_sha256?: string;
};

export type BrakeDeviceConnectionContext = {
  profileId: string;
  profileDigest: string;
  sourceInstanceId: string;
  deviceSerial: string;
  bindingRevision: number;
  rangeMin: string;
  rangeMax: string;
  rangeUnit: string;
};

export type BrakeMeasurementFetchEnvelope =
  | { status: 'NOT_CONFIGURED' }
  | { status: 'NOT_FOUND' }
  | { status: 'ERROR' }
  | { status: 'TIMEOUT' }
  | {
      status: 'RESULT';
      canonical: CanonicalBrakeMeasurement;
      originalUtf8: string;
    };
