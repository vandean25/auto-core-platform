import {
  manifestContentSha256,
  resolveCatalogueReference,
} from './inspection-catalog-canonical.js';
import { SYNTHETIC_STATUTORY_MANIFEST } from './inspection-catalog-synthetic-fixtures.js';

describe('inspection-catalog-canonical', () => {
  it('resolves statutory position 0.1', () => {
    const status = resolveCatalogueReference({
      manifest: SYNTHETIC_STATUTORY_MANIFEST,
      request: { position_id: '0.1', entry_id: null },
      inspectionTime: new Date('2026-10-16T10:00:00.000Z'),
      vehicleClass: 'M1',
      forCurrentUse: true,
    });
    expect(status).toBe('RESOLVED');
  });

  it('flags unknown codes', () => {
    const status = resolveCatalogueReference({
      manifest: SYNTHETIC_STATUTORY_MANIFEST,
      request: { position_id: 'SYNTH-NOT-A-CODE', entry_id: null },
      inspectionTime: new Date('2026-10-16T10:00:00.000Z'),
      forCurrentUse: true,
    });
    expect(status).toBe('UNKNOWN_CODE');
  });

  it('flags stale catalogue after recheck_after', () => {
    const status = resolveCatalogueReference({
      manifest: SYNTHETIC_STATUTORY_MANIFEST,
      request: { position_id: '0.1', entry_id: null },
      inspectionTime: new Date('2026-11-15T10:00:01.000Z'),
      vehicleClass: 'M1',
      forCurrentUse: true,
    });
    expect(status).toBe('STALE_CATALOG');
  });

  it('computes stable manifest digest', () => {
    const digest = manifestContentSha256(SYNTHETIC_STATUTORY_MANIFEST);
    expect(digest).toHaveLength(64);
    expect(manifestContentSha256(SYNTHETIC_STATUTORY_MANIFEST)).toBe(digest);
  });
});
