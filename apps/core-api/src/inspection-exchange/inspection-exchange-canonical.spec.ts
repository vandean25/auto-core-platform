import {
  inspectedOnInVienna,
  parseCanonicalInspectionResultUtf8,
} from './inspection-exchange-canonical.js';
import { SYNTHETIC_CANONICAL_POSITIVE } from './inspection-exchange-synthetic-fixtures.js';

describe('parseCanonicalInspectionResultUtf8', () => {
  it('accepts synthetic positive fixture', () => {
    const parsed = parseCanonicalInspectionResultUtf8(
      JSON.stringify(SYNTHETIC_CANONICAL_POSITIVE),
    );
    expect(parsed.schema_version).toBe('acp-inspection-result/1');
    expect(parsed.outcome).toBe('POSITIVE');
  });

  it('rejects malformed JSON', () => {
    expect(() => parseCanonicalInspectionResultUtf8('{"schema_version":')).toThrow();
  });

  it('rejects unknown odometer unit', () => {
    const body = {
      ...SYNTHETIC_CANONICAL_POSITIVE,
      odometer: { value: '1.000', unit: 'mile' },
    };
    expect(() =>
      parseCanonicalInspectionResultUtf8(JSON.stringify(body)),
    ).toThrow();
  });
});

describe('inspectedOnInVienna', () => {
  it('maps UTC evening to next Vienna calendar day', () => {
    expect(inspectedOnInVienna('2026-10-15T22:30:00Z')).toBe('2026-10-16');
  });
});
