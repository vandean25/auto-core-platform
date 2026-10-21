import type { CanonicalBrakeMeasurement } from './inspection-measurement.types.js';

function syntheticMeasuredAtIso(): string {
  const measured = new Date(Date.now() - 30 * 60 * 1000);
  return measured.toISOString().replace(/\.\d{3}Z$/, '+00:00');
}

export const SYNTHETIC_BRAKE_MEASUREMENT: CanonicalBrakeMeasurement = {
  schema_version: 'acp-brake-measurement/1',
  native_schema_version: 'TEST_ONLY/1',
  source_system: 'WORKSHOP_NET',
  source_instance_id: 'SYNTH-NETWORK-1',
  measurement_id: 'SYNTH-MEASUREMENT-1',
  revision: 'SYNTH-REV-1',
  previous_measurement_ref: null,
  device_serial: 'SYNTH-BRAKE-SERIAL-1',
  device_model: 'SYNTH-BRAKE-MODEL',
  device_software_version: 'TEST_ONLY',
  vehicle_vin: 'WVWZZZ1JZXW000001',
  workshop_order_ref: 'SYNTH-ORDER-1',
  session_ref: 'SYNTH-SESSION-1',
  measured_at: syntheticMeasuredAtIso(),
  received_at: new Date().toISOString(),
  finality: 'FINAL',
  test_kind: 'SERVICE_BRAKE',
  wheels: [
    { axle: 1, side: 'LEFT', force: '2.100', unit: 'kN' },
    { axle: 1, side: 'RIGHT', force: '2.000', unit: 'kN' },
    { axle: 2, side: 'LEFT', force: '1.200', unit: 'kN' },
    { axle: 2, side: 'RIGHT', force: '1.100', unit: 'kN' },
  ],
  device_range: { min: '0.000', max: '10.000', unit: 'kN' },
  device_evidence_ref: 'SYNTH-DEVICE-EVIDENCE-1',
  native_result_ref: 'SYNTH-NATIVE-RESULT-1',
};

const RECORDED_BY_REFERENCE: Record<string, CanonicalBrakeMeasurement> = {
  'SYNTH-NATIVE-RESULT-1': SYNTHETIC_BRAKE_MEASUREMENT,
};

export function lookupSyntheticBrakeMeasurement(
  nativeReference: string,
): CanonicalBrakeMeasurement | null {
  return RECORDED_BY_REFERENCE[nativeReference] ?? null;
}

export function registerSyntheticMeasurement(
  reference: string,
  overrides: Partial<CanonicalBrakeMeasurement> = {},
): void {
  const base =
    RECORDED_BY_REFERENCE[reference] ??
    structuredClone(SYNTHETIC_BRAKE_MEASUREMENT);
  RECORDED_BY_REFERENCE[reference] = {
    ...base,
    ...overrides,
    wheels: overrides.wheels ?? base.wheels,
    device_range: overrides.device_range ?? base.device_range,
  };
}
