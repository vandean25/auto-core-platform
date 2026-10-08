import { computeGewaehrleistung } from './compute-gewaehrleistung.js';

const sale = {
  contractConcludedAt: new Date('2026-10-02T00:00:00.000Z'),
  handedOverAt: new Date('2026-10-08T00:00:00.000Z'),
  buyerIsConsumer: true,
  shortenedNegotiated: false,
  firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
};

describe('computeGewaehrleistung', () => {
  it('computes two calendar years from handover for a consumer', () => {
    expect(computeGewaehrleistung(sale).baseEndsOn).toEqual(
      new Date('2028-10-08T00:00:00.000Z'),
    );
  });

  it('computes one year for qualifying negotiated shortening', () => {
    expect(
      computeGewaehrleistung({ ...sale, shortenedNegotiated: true }).baseEndsOn,
    ).toEqual(new Date('2027-10-08T00:00:00.000Z'));
  });

  it('computes one year of presumption independently of the base period', () => {
    expect(computeGewaehrleistung(sale).presumptionEndsOn).toEqual(
      new Date('2027-10-08T00:00:00.000Z'),
    );
  });

  it.each([
    [
      'missing registration',
      { firstRegistrationDate: null },
      'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED',
    ],
    [
      'exactly one year old',
      { firstRegistrationDate: new Date('2025-10-08T00:00:00.000Z') },
      'GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW',
    ],
    [
      'less than one year old',
      { firstRegistrationDate: new Date('2025-10-09T00:00:00.000Z') },
      'GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW',
    ],
    [
      'non-consumer',
      { buyerIsConsumer: false },
      'GEWAEHRLEISTUNG_SHORTENING_REQUIRES_CONSUMER',
    ],
  ])(
    'rejects shortening for %s without emitting dates',
    (_, overrides, code) => {
      expect(
        computeGewaehrleistung({
          ...sale,
          shortenedNegotiated: true,
          ...overrides,
        }),
      ).toMatchObject({
        baseEndsOn: null,
        presumptionEndsOn: null,
        error: { code, message: expect.any(String) as string },
      });
    },
  );

  it('accepts registration one day earlier than the one-year anniversary', () => {
    expect(
      computeGewaehrleistung({
        ...sale,
        shortenedNegotiated: true,
        firstRegistrationDate: new Date('2025-10-07T00:00:00.000Z'),
      }).baseEndsOn,
    ).toEqual(new Date('2027-10-08T00:00:00.000Z'));
  });

  it('does not require registration without negotiated shortening', () => {
    expect(
      computeGewaehrleistung({ ...sale, firstRegistrationDate: null })
        .baseEndsOn,
    ).toEqual(new Date('2028-10-08T00:00:00.000Z'));
  });

  it('returns no statutory dates for a non-consumer', () => {
    expect(computeGewaehrleistung({ ...sale, buyerIsConsumer: false })).toEqual(
      {
        baseEndsOn: null,
        presumptionEndsOn: null,
        ruleVersion: 'at-used-vehicle-vgg-2026-10-v2',
      },
    );
  });

  it.each([{ contractConcludedAt: null }, { handedOverAt: null }])(
    'returns no snapshot when a required date is absent: %j',
    (overrides) => {
      expect(computeGewaehrleistung({ ...sale, ...overrides })).toEqual({
        baseEndsOn: null,
        presumptionEndsOn: null,
        ruleVersion: null,
      });
    },
  );

  it.each([
    ['2022-01-01', 'at-used-vehicle-vgg-2022-v1'],
    ['2026-09-30', 'at-used-vehicle-vgg-2022-v1'],
    ['2026-10-01', 'at-used-vehicle-vgg-2026-10-v2'],
  ])(
    'selects the rule version using contract date %s',
    (contractDate, version) => {
      expect(
        computeGewaehrleistung({
          ...sale,
          contractConcludedAt: new Date(`${contractDate}T00:00:00.000Z`),
        }).ruleVersion,
      ).toBe(version);
    },
  );

  it('rejects a contract before supported rules without emitting dates', () => {
    expect(
      computeGewaehrleistung({
        ...sale,
        contractConcludedAt: new Date('2021-12-31T00:00:00.000Z'),
      }),
    ).toMatchObject({
      baseEndsOn: null,
      presumptionEndsOn: null,
      ruleVersion: null,
      error: { code: 'GEWAEHRLEISTUNG_RULE_NOT_AVAILABLE' },
    });
  });

  it('clamps a leap-day handover anniversary to February 28', () => {
    expect(
      computeGewaehrleistung({
        ...sale,
        contractConcludedAt: new Date('2024-02-20T00:00:00.000Z'),
        handedOverAt: new Date('2024-02-29T00:00:00.000Z'),
      }),
    ).toEqual({
      baseEndsOn: new Date('2026-02-28T00:00:00.000Z'),
      presumptionEndsOn: new Date('2025-02-28T00:00:00.000Z'),
      ruleVersion: 'at-used-vehicle-vgg-2022-v1',
    });
  });

  it('compares vehicle age as UTC dates rather than timestamps', () => {
    expect(
      computeGewaehrleistung({
        ...sale,
        shortenedNegotiated: true,
        handedOverAt: new Date('2026-10-08T23:00:00.000Z'),
        firstRegistrationDate: new Date('2025-10-08T01:00:00.000Z'),
      }).error?.code,
    ).toBe('GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW');
  });

  it('does not mutate the supplied dates', () => {
    const input = {
      ...sale,
      handedOverAt: new Date('2026-10-08T18:00:00.000Z'),
    };
    computeGewaehrleistung(input);
    expect(input.handedOverAt.toISOString()).toBe('2026-10-08T18:00:00.000Z');
  });
});
