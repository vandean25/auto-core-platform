import { calculateNova } from './calculate-nova.js';
import { resolveTariffVersion } from './tariff-table.js';
import { NovaCalculationError } from './types.js';

const T = 'at-m1-2025-h1';
const baseInput = {
  emissionCycle: 'WLTP' as const,
  netPriceEuro: 30_000,
  driveType: 'ICE' as const,
  taxableEventDate: '2025-03-01',
};

describe('calculateNova', () => {
  it('exempts pure BEV', () => {
    const result = calculateNova(
      {
        ...baseInput,
        driveType: 'BEV',
        co2GramsPerKm: 0,
      },
      T,
    );
    expect(result.novaAmountEuro).toBe(0);
    expect(result.appliedRuleIds).toContain('exempt.z3.zero_co2');
  });

  it('exempts FCEV', () => {
    const result = calculateNova(
      { ...baseInput, driveType: 'FCEV', co2GramsPerKm: 0 },
      T,
    );
    expect(result.novaAmountEuro).toBe(0);
  });

  it('throws MISSING_CO2 when CO₂ absent for ICE', () => {
    expect(() =>
      calculateNova({ ...baseInput, driveType: 'ICE' }, T),
    ).toThrow(NovaCalculationError);
    try {
      calculateNova({ ...baseInput, driveType: 'ICE' }, T);
    } catch (e) {
      expect((e as NovaCalculationError).code).toBe('MISSING_CO2');
    }
  });

  it('throws UNKNOWN_TARIFF_VERSION for bad id', () => {
    expect(() =>
      calculateNova({ ...baseInput, co2GramsPerKm: 120 }, 'no-such-tariff'),
    ).toThrow(NovaCalculationError);
  });

  it('throws INVALID_NET_PRICE for negative net', () => {
    expect(() =>
      calculateNova(
        { ...baseInput, co2GramsPerKm: 120, netPriceEuro: -1 },
        T,
      ),
    ).toThrow(NovaCalculationError);
  });

  it('warns on PHEV drive type', () => {
    const result = calculateNova(
      { ...baseInput, driveType: 'PHEV', co2GramsPerKm: 40 },
      T,
    );
    expect(result.warnings).toContain('phev_weighted_wltp');
  });

  it('applies NEDC to WLTP factor 1.27', () => {
    const wltp = calculateNova(
      { ...baseInput, co2GramsPerKm: 100, emissionCycle: 'WLTP' },
      T,
    );
    const nedc = calculateNova(
      { ...baseInput, co2GramsPerKm: 100, emissionCycle: 'NEDC' },
      T,
    );
    expect(nedc.effectiveCo2GramsPerKm).toBe(127);
    expect(nedc.novaAmountEuro).toBeGreaterThan(wltp.novaAmountEuro);
    expect(nedc.appliedRuleIds).toContain('co2.nedc_to_wltp_factor');
  });

  it('uses ratedPowerKw substitute when CO₂ missing', () => {
    const result = calculateNova(
      { ...baseInput, ratedPowerKw: 100 },
      T,
    );
    expect(result.effectiveCo2GramsPerKm).toBe(200);
    expect(result.appliedRuleIds).toContain('co2.substitute_double_kw');
  });

  describe('malus threshold boundaries (155 g/km)', () => {
    it.each([
      { co2: 154, malusEur: 0 },
      { co2: 155, malusEur: 0 },
      { co2: 156, malusEur: 80 },
    ])('co2=$co2 malus €$malusEur', ({ co2, malusEur }) => {
      const result = calculateNova({ ...baseInput, co2GramsPerKm: co2 }, T);
      const base = (30_000 * result.ratePercentApplied) / 100;
      expect(result.novaAmountEuro).toBe(
        Math.round((base + malusEur - 350) * 100) / 100,
      );
    });

    it('increases by €80 when crossing 155 g/km', () => {
      const at155 = calculateNova({ ...baseInput, co2GramsPerKm: 155 }, T);
      const at156 = calculateNova({ ...baseInput, co2GramsPerKm: 156 }, T);
      expect(at156.novaAmountEuro - at155.novaAmountEuro).toBe(80);
    });
  });

  describe('CO₂ deduction boundary (94 g)', () => {
    it.each([
      { co2: 93, rate: 0 },
      { co2: 94, rate: 0 },
      { co2: 95, rate: 0 },
      { co2: 99, rate: 1 },
    ])('co2=$co2 → rate $rate%', ({ co2, rate }) => {
      const result = calculateNova({ ...baseInput, co2GramsPerKm: co2 }, T);
      expect(result.ratePercentApplied).toBe(rate);
    });
  });

  it('caps rate at 80% for extreme CO₂', () => {
    const result = calculateNova({ ...baseInput, co2GramsPerKm: 600 }, T);
    expect(result.ratePercentApplied).toBe(80);
    expect(result.appliedRuleIds).toContain('tariff.max_rate_cap');
  });

  it('applies flat €350 deduction', () => {
    const result = calculateNova({ ...baseInput, co2GramsPerKm: 120 }, T);
    const base = (30_000 * result.ratePercentApplied) / 100;
    expect(result.novaAmountEuro).toBe(
      Math.round((base - 350) * 100) / 100,
    );
  });

  it('floors total at zero (no tax credit)', () => {
    const result = calculateNova(
      { ...baseInput, co2GramsPerKm: 94, netPriceEuro: 1_000 },
      T,
    );
    expect(result.novaAmountEuro).toBe(0);
    expect(result.appliedRuleIds).toContain('tariff.no_tax_credit_floor');
  });

  it('rounds rate percent half-up', () => {
    const result = calculateNova({ ...baseInput, co2GramsPerKm: 97 }, T);
    expect(result.ratePercentApplied).toBe(1);
  });

  it('computes 2024 tariff slice', () => {
    const result = calculateNova(
      { ...baseInput, co2GramsPerKm: 120 },
      'at-m1-2024',
    );
    expect(result.ratePercentApplied).toBe(5);
    expect(result.tariffVersionId).toBe('at-m1-2024');
  });

  it('computes 2022 tariff with 60% cap', () => {
    const result = calculateNova(
      { ...baseInput, co2GramsPerKm: 410 },
      'at-m1-2022',
    );
    expect(result.ratePercentApplied).toBe(60);
    expect(result.appliedRuleIds).toContain('tariff.max_rate_cap');
  });

  it('resolves tariff by taxable event date', () => {
    const row = resolveTariffVersion('passenger_z3', '2024-06-15');
    expect(row?.id).toBe('at-m1-2024');
  });

  it('resolves 2025 H2 from July', () => {
    const row = resolveTariffVersion('passenger_z3', '2025-08-01');
    expect(row?.id).toBe('at-m1-2025-h2');
  });

  it('warns on fractional CO₂ after NEDC factor', () => {
    const result = calculateNova(
      {
        ...baseInput,
        co2GramsPerKm: 130,
        emissionCycle: 'NEDC',
      },
      'at-m1-2026',
    );
    expect(result.effectiveCo2GramsPerKm).toBe(165.1);
    expect(result.warnings).toContain('fractional_co2_unverified');
  });

  it('rejects NEDC for motorcycles', () => {
    expect(() =>
      calculateNova(
        {
          ...baseInput,
          vehicleClass: 'motorcycle_z1_z2',
          co2GramsPerKm: 100,
          emissionCycle: 'NEDC',
        },
        'at-mc-2024-h1',
      ),
    ).toThrow(NovaCalculationError);
  });

  it('motorcycle hubraum substitute has no €350 deduction', () => {
    const result = calculateNova(
      {
        ...baseInput,
        vehicleClass: 'motorcycle_z1_z2',
        displacementCc: 600,
        taxableEventDate: '2024-06-01',
      },
      'at-mc-2024-h1',
    );
    expect(result.ratePercentApplied).toBe(10);
    expect(result.novaAmountEuro).toBe(3_000);
  });

  describe('table-driven M1 2025 H1 samples', () => {
    const samples = [
      { co2: 120, net: 30_000, expected: 1_150 },
      { co2: 200, net: 40_000, expected: 11_650 },
      { co2: 156, net: 30_000, expected: 3_330 },
    ];
    it.each(samples)(
      'co2=$co2 net=$net → €$expected',
      ({ co2, net, expected }) => {
        const result = calculateNova(
          { ...baseInput, co2GramsPerKm: co2, netPriceEuro: net },
          T,
        );
        expect(result.novaAmountEuro).toBe(expected);
      },
    );
  });

  describe('N1 malus boundary 208 g/km', () => {
    it.each([207, 208, 209])('co2=%i', (co2) => {
      const result = calculateNova(
        {
          ...baseInput,
          vehicleClass: 'n1_legacy_z6',
          co2GramsPerKm: co2,
        },
        'at-n1-2025-h1',
      );
      const malus = Math.max(0, co2 - 208) * 80;
      const base = (30_000 * result.ratePercentApplied) / 100;
      expect(result.novaAmountEuro).toBe(
        Math.round((base + malus - 350) * 100) / 100,
      );
    });
  });

  describe('percent rounding boundaries', () => {
    it.each([
      { co2: 96, rate: 0 },
      { co2: 97, rate: 1 },
      { co2: 98, rate: 1 },
      { co2: 99, rate: 1 },
      { co2: 100, rate: 1 },
      { co2: 101, rate: 1 },
      { co2: 102, rate: 2 },
    ])('co2=$co2 → $rate%', ({ co2, rate }) => {
      expect(
        calculateNova({ ...baseInput, co2GramsPerKm: co2 }, T).ratePercentApplied,
      ).toBe(rate);
    });
  });

  it('money rounds to two decimals', () => {
    const result = calculateNova(
      { ...baseInput, co2GramsPerKm: 130, netPriceEuro: 33_333.33 },
      T,
    );
    expect(String(result.novaAmountEuro)).toMatch(/^\d+(\.\d{1,2})?$/);
  });
});
