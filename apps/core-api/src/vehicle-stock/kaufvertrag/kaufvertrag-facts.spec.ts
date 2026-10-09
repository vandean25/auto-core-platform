import { UnprocessableEntityException } from '@nestjs/common';
import {
  assertKaufvertragSaleEligible,
  resolveKaufvertragGewaehrleistung,
  type KaufvertragGewaehrleistungInput,
} from './kaufvertrag-facts.js';

const CONSUMER_SALE: KaufvertragGewaehrleistungInput = {
  contractConcludedAt: new Date('2026-10-02T00:00:00.000Z'),
  handedOverAt: new Date('2026-10-08T00:00:00.000Z'),
  buyerIsConsumer: true,
  shortenedNegotiated: false,
  firstRegistrationDate: new Date('2020-10-08T00:00:00.000Z'),
  stored: {
    baseEndsOn: new Date('2028-10-08T00:00:00.000Z'),
    presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
    ruleVersion: 'at-used-vehicle-vgg-2026-10-v2',
  },
};

function expectUnprocessable(fn: () => unknown, code: string) {
  try {
    fn();
  } catch (error) {
    expect(error).toBeInstanceOf(UnprocessableEntityException);
    expect((error as UnprocessableEntityException).getResponse()).toMatchObject({
      code,
    });
    return;
  }
  throw new Error(`Expected UnprocessableEntityException with code ${code}`);
}

describe('resolveKaufvertragGewaehrleistung', () => {
  it('uses the two-year base period for a consumer without shortening', () => {
    const result = resolveKaufvertragGewaehrleistung({
      ...CONSUMER_SALE,
      stored: {
        baseEndsOn: new Date('2028-10-08T00:00:00.000Z'),
        presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
        ruleVersion: 'at-used-vehicle-vgg-2026-10-v2',
      },
    });

    expect(result).toMatchObject({
      regime: 'CONSUMER_BASE',
      basePeriodYears: 2,
      presumptionPeriodYears: 1,
      baseEndsOn: new Date('2028-10-08T00:00:00.000Z'),
      presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
      ruleVersion: 'at-used-vehicle-vgg-2026-10-v2',
    });
  });

  it('accepts a negotiated one-year period when first registration is more than a year before handover', () => {
    const input = {
      ...CONSUMER_SALE,
      shortenedNegotiated: true,
      stored: {
        baseEndsOn: new Date('2027-10-08T00:00:00.000Z'),
        presumptionEndsOn: new Date('2027-10-08T00:00:00.000Z'),
        ruleVersion: 'at-used-vehicle-vgg-2026-10-v2',
      },
    };

    expect(resolveKaufvertragGewaehrleistung(input)).toMatchObject({
      regime: 'CONSUMER_SHORTENED',
      basePeriodYears: 1,
      baseEndsOn: new Date('2027-10-08T00:00:00.000Z'),
    });
  });

  it.each([
    [
      'first registration exactly one year before handover',
      new Date('2025-10-08T00:00:00.000Z'),
      'GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW',
    ],
    [
      'first registration less than a year before handover',
      new Date('2026-06-01T00:00:00.000Z'),
      'GEWAEHRLEISTUNG_SHORTENING_VEHICLE_TOO_NEW',
    ],
  ])(
    'blocks a negotiated one-year period for %s',
    (_label, firstRegistrationDate, code) => {
      expectUnprocessable(
        () =>
          resolveKaufvertragGewaehrleistung({
            ...CONSUMER_SALE,
            shortenedNegotiated: true,
            firstRegistrationDate,
            stored: {
              baseEndsOn: null,
              presumptionEndsOn: null,
              ruleVersion: null,
            },
          }),
        code,
      );
    },
  );

  it('blocks a negotiated one-year period without a first registration date', () => {
    expectUnprocessable(
      () =>
        resolveKaufvertragGewaehrleistung({
          ...CONSUMER_SALE,
          shortenedNegotiated: true,
          firstRegistrationDate: null,
          stored: { baseEndsOn: null, presumptionEndsOn: null, ruleVersion: null },
        }),
      'GEWAEHRLEISTUNG_FIRST_REGISTRATION_REQUIRED',
    );
  });

  it('blocks a negotiated one-year period for a non-consumer buyer', () => {
    expectUnprocessable(
      () =>
        resolveKaufvertragGewaehrleistung({
          ...CONSUMER_SALE,
          buyerIsConsumer: false,
          shortenedNegotiated: true,
          stored: { baseEndsOn: null, presumptionEndsOn: null, ruleVersion: null },
        }),
      'GEWAEHRLEISTUNG_SHORTENING_REQUIRES_CONSUMER',
    );
  });

  it('returns per-contract facts without dates for a non-consumer buyer', () => {
    const result = resolveKaufvertragGewaehrleistung({
      ...CONSUMER_SALE,
      buyerIsConsumer: false,
      stored: {
        baseEndsOn: null,
        presumptionEndsOn: null,
        ruleVersion: 'at-used-vehicle-vgg-2026-10-v2',
      },
    });

    expect(result).toEqual({
      contractConcludedAt: new Date('2026-10-02T00:00:00.000Z'),
      handedOverAt: new Date('2026-10-08T00:00:00.000Z'),
      regime: 'B2B_PER_CONTRACT',
      buyerIsConsumer: false,
      basePeriodYears: null,
      presumptionPeriodYears: null,
      baseEndsOn: null,
      presumptionEndsOn: null,
      ruleVersion: 'at-used-vehicle-vgg-2026-10-v2',
    });
  });

  it('refuses a missing contract conclusion date', () => {
    expectUnprocessable(
      () =>
        resolveKaufvertragGewaehrleistung({
          ...CONSUMER_SALE,
          contractConcludedAt: null,
        }),
      'KAUFVERTRAG_CONTRACT_DATE_REQUIRED',
    );
  });

  it('refuses a missing handover date', () => {
    expectUnprocessable(
      () =>
        resolveKaufvertragGewaehrleistung({
          ...CONSUMER_SALE,
          handedOverAt: null,
        }),
      'KAUFVERTRAG_HANDOVER_DATE_REQUIRED',
    );
  });

  it('refuses contracts before the earliest rule set', () => {
    expectUnprocessable(
      () =>
        resolveKaufvertragGewaehrleistung({
          ...CONSUMER_SALE,
          contractConcludedAt: new Date('2021-12-31T00:00:00.000Z'),
          handedOverAt: new Date('2022-01-10T00:00:00.000Z'),
          stored: { baseEndsOn: null, presumptionEndsOn: null, ruleVersion: null },
        }),
      'GEWAEHRLEISTUNG_RULE_NOT_AVAILABLE',
    );
  });

  it.each([
    [
      'base end date',
      { baseEndsOn: new Date('2028-10-07T00:00:00.000Z') },
    ],
    [
      'presumption end date',
      { presumptionEndsOn: new Date('2027-10-09T00:00:00.000Z') },
    ],
    [
      'rule version',
      { ruleVersion: 'at-used-vehicle-vgg-2022-v1' },
    ],
  ])(
    'refuses when the stored snapshot disagrees on %s',
    (_label, override) => {
      expectUnprocessable(
        () =>
          resolveKaufvertragGewaehrleistung({
            ...CONSUMER_SALE,
            stored: { ...CONSUMER_SALE.stored, ...override },
          }),
        'KAUFVERTRAG_GEWAEHRLEISTUNG_SNAPSHOT_STALE',
      );
    },
  );
});

describe('assertKaufvertragSaleEligible', () => {
  const eligible = {
    status: 'DRAFT' as const,
    vin: 'WVWZZZ1JZXW000001',
    seller: { country_iso: 'AT' },
  };

  it('accepts draft and invoiced sales with an Austrian seller and a VIN', () => {
    expect(() => assertKaufvertragSaleEligible(eligible)).not.toThrow();
    expect(() =>
      assertKaufvertragSaleEligible({ ...eligible, status: 'INVOICED' }),
    ).not.toThrow();
  });

  it('refuses cancelled sales', () => {
    expectUnprocessable(
      () =>
        assertKaufvertragSaleEligible({ ...eligible, status: 'CANCELLED' }),
      'KAUFVERTRAG_SALE_CANCELLED',
    );
  });

  it.each([null, '', '   '])('refuses a vehicle without VIN (%p)', (vin) => {
    expectUnprocessable(
      () => assertKaufvertragSaleEligible({ ...eligible, vin }),
      'KAUFVERTRAG_VIN_REQUIRED',
    );
  });

  it('refuses a seller outside Austria', () => {
    expectUnprocessable(
      () => assertKaufvertragSaleEligible({ ...eligible, seller: { country_iso: 'DE' } }),
      'KAUFVERTRAG_SELLER_COUNTRY_UNSUPPORTED',
    );
  });
});

describe('assertKaufvertragSaleEligible site and identity', () => {
  it('refuses a sale without a site, and so without a seller legal entity', () => {
    expectUnprocessable(
      () =>
        assertKaufvertragSaleEligible({
          status: 'DRAFT',
          vin: 'WVWZZZ1JZXW000001',
          seller: null,
        }),
      'KAUFVERTRAG_SITE_REQUIRED',
    );
  });

  it('returns the trimmed VIN for an eligible sale', () => {
    expect(
      assertKaufvertragSaleEligible({
        status: 'INVOICED',
        vin: '  WVWZZZ1JZXW000001 ',
        seller: { country_iso: 'AT' },
      }),
    ).toEqual({
      vin: 'WVWZZZ1JZXW000001',
      seller: { country_iso: 'AT' },
    });
  });
});
