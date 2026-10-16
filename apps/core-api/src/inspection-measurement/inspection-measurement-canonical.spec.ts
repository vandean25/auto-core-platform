import {
  assertForcesWithinDeviceRange,
  parseCanonicalBrakeMeasurementUtf8,
} from './inspection-measurement-canonical.js';
import { SYNTHETIC_BRAKE_MEASUREMENT } from './inspection-measurement-synthetic-fixtures.js';

describe('inspection-measurement-canonical', () => {
  it('parses synthetic brake measurement fixture', () => {
    const parsed = parseCanonicalBrakeMeasurementUtf8(
      JSON.stringify(SYNTHETIC_BRAKE_MEASUREMENT),
    );
    expect(parsed.measurement_id).toBe('SYNTH-MEASUREMENT-1');
    assertForcesWithinDeviceRange(parsed, '0.000', '10.000');
  });

  it('rejects unknown top-level property', () => {
    const payload = { ...SYNTHETIC_BRAKE_MEASUREMENT, note: 'extra' };
    expect(() =>
      parseCanonicalBrakeMeasurementUtf8(JSON.stringify(payload)),
    ).toThrow();
  });

  it('rejects measured_at without timezone offset', () => {
    const payload = {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      measured_at: '2026-10-16T11:15:00',
    };
    expect(() =>
      parseCanonicalBrakeMeasurementUtf8(JSON.stringify(payload)),
    ).toThrow();
  });

  it('rejects unsupported wheel unit', () => {
    const payload = {
      ...SYNTHETIC_BRAKE_MEASUREMENT,
      wheels: [{ ...SYNTHETIC_BRAKE_MEASUREMENT.wheels[0], unit: 'daN' }],
    };
    expect(() =>
      parseCanonicalBrakeMeasurementUtf8(JSON.stringify(payload)),
    ).toThrow();
  });
});
