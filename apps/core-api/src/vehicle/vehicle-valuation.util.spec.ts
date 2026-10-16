import {
  assessNationalCodeIdentity,
  createValuationInputSha256,
  isValuationStale,
  todayInViennaYmd,
} from './vehicle-valuation.util.js';

describe('vehicle-valuation.util', () => {
  it('marks provider as-of before today as stale in Vienna', () => {
    const readOn = new Date('2026-10-15T12:00:00.000Z');
    expect(isValuationStale('2026-10-01', readOn)).toBe(true);
    expect(isValuationStale('2026-10-15', readOn)).toBe(false);
  });

  it('builds deterministic input sha256', () => {
    const hash = createValuationInputSha256({
      vehicleId: '00000000-0000-4000-8000-000000000527',
      nationalCode: '100527',
      valuationType: 'MARKET_VALUE',
      mileageKm: 84200,
      condition: 'ROADWORTHY_AVERAGE',
      requestedAsOf: '2026-10-15',
      currency: 'EUR',
      contractVersion: 'acp-valuation-contract-1',
    });
    expect(hash).toHaveLength(64);
    expect(hash).toMatch(/^[a-f0-9]{64}$/);
  });

  it('rejects uncertain national codes', () => {
    expect(
      assessNationalCodeIdentity({
        nationalCode: 'WAUZZZSYNTH000528',
        vin: 'WAUZZZSYNTH000528',
        typenscheinNo: null,
      }).ok,
    ).toBe(false);
    expect(
      assessNationalCodeIdentity({
        nationalCode: '100529',
        vin: null,
        typenscheinNo: '100529',
      }).ok,
    ).toBe(false);
    expect(
      assessNationalCodeIdentity({
        nationalCode: '100527',
        vin: 'WAUZZZSYNTH000527',
        typenscheinNo: 'TS-SYNTH-527',
      }).ok,
    ).toBe(true);
  });

  it('formats today in Vienna', () => {
    expect(todayInViennaYmd(new Date('2026-10-15T22:00:00.000Z'))).toBe(
      '2026-10-16',
    );
  });
});
