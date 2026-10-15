import {
  fieldSideConflict,
  normalizeRegistrationEvidenceFields,
} from './registration-intake-evidence.normalizer.js';
import type { RegistrationFieldEvidence } from './registration-document-extraction.types.js';

describe('normalizeRegistrationEvidenceFields', () => {
  it('records CO2_CYCLE_UNKNOWN when CO2 value has no printed cycle', () => {
    const fields: Record<string, RegistrationFieldEvidence> = {
      vin: {
        raw: 'WVWZZZSYNTH000001',
        normalized: 'WVWZZZSYNTH000001',
        uncertainty: 0.05,
      },
      co2: {
        raw: '119',
        normalized: 119,
        uncertainty: 0.04,
      },
    };
    const { cases } = normalizeRegistrationEvidenceFields(fields, 'WVWZZZSYNTH000001');
    expect(cases).toContain('CO2_CYCLE_UNKNOWN');
  });

  it('flags FIELD_SIDE_CONFLICT for plate disagreements across sides', () => {
    const fields: Record<string, RegistrationFieldEvidence> = {
      plate: {
        raw: 'W A',
        normalized: 'W A',
        uncertainty: 1,
        alternate: {
          raw: 'W B',
          normalized: 'W B',
          uncertainty: 0.1,
        },
      },
    };
    expect(fieldSideConflict(fields)).toBe(true);
    const { cases } = normalizeRegistrationEvidenceFields(
      {
        vin: {
          raw: 'WVWZZZSYNTH000001',
          normalized: 'WVWZZZSYNTH000001',
          uncertainty: 0.05,
        },
        ...fields,
      },
      'WVWZZZSYNTH000001',
    );
    expect(cases).toContain('FIELD_SIDE_CONFLICT');
  });
});
