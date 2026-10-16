import {
  manifestContentSha256,
  resolveCatalogueReference,
} from './inspection-catalog-canonical.js';
import { SYNTHETIC_STATUTORY_MANIFEST } from './inspection-catalog-synthetic-fixtures.js';

describe('inspection-catalog-canonical', () => {
  it('resolves statutory position 0.1 for position-only attach', () => {
    const status = resolveCatalogueReference({
      manifest: SYNTHETIC_STATUTORY_MANIFEST,
      request: { position_id: '0.1', entry_id: null },
      inspectionTime: new Date('2026-10-16T10:00:00.000Z'),
      vehicleClass: 'M1',
      forCurrentUse: true,
      lookupPurpose: 'position_only',
    });
    expect(status).toBe('RESOLVED');
  });

  it('keeps unsourced scope OUT_OF_SCOPE for scoped recommendation even with vehicle class', () => {
    const status = resolveCatalogueReference({
      manifest: SYNTHETIC_STATUTORY_MANIFEST,
      request: { position_id: '0.1', entry_id: null },
      inspectionTime: new Date('2026-10-16T10:00:00.000Z'),
      vehicleClass: 'M1',
      forCurrentUse: true,
      lookupPurpose: 'scoped_recommendation',
    });
    expect(status).toBe('OUT_OF_SCOPE');
  });

  it('flags unknown codes', () => {
    const status = resolveCatalogueReference({
      manifest: SYNTHETIC_STATUTORY_MANIFEST,
      request: { position_id: 'SYNTH-NOT-A-CODE', entry_id: null },
      inspectionTime: new Date('2026-10-16T10:00:00.000Z'),
      forCurrentUse: true,
      lookupPurpose: 'position_only',
    });
    expect(status).toBe('UNKNOWN_CODE');
  });

  it('flags stale catalogue at recheck_after (inclusive)', () => {
    const status = resolveCatalogueReference({
      manifest: SYNTHETIC_STATUTORY_MANIFEST,
      request: { position_id: '0.1', entry_id: null },
      inspectionTime: new Date('2026-11-15T10:00:00.000Z'),
      vehicleClass: 'M1',
      forCurrentUse: true,
      lookupPurpose: 'position_only',
    });
    expect(status).toBe('STALE_CATALOG');
  });

  it('computes stable manifest digest', () => {
    const digest = manifestContentSha256(SYNTHETIC_STATUTORY_MANIFEST);
    expect(digest).toHaveLength(64);
    expect(manifestContentSha256(SYNTHETIC_STATUTORY_MANIFEST)).toBe(digest);
  });
});
