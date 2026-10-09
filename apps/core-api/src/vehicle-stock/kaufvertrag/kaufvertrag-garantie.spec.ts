import {
  GARANTIE_TERMS_REQUIRE_DURATION,
  resolveGarantieFacts,
} from './kaufvertrag-garantie.js';

describe('resolveGarantieFacts', () => {
  it('keeps a duration with its terms', () => {
    expect(
      resolveGarantieFacts({
        months: 12,
        terms: 'Motorschaden ausgenommen',
        termsProvided: true,
      }),
    ).toEqual({
      garantie_months: 12,
      garantie_terms: 'Motorschaden ausgenommen',
    });
  });

  it('stores blank terms as null when a duration is set', () => {
    expect(
      resolveGarantieFacts({ months: 12, terms: '   ', termsProvided: true }),
    ).toEqual({ garantie_months: 12, garantie_terms: null });
  });

  it('treats blank terms without a duration as absent', () => {
    expect(
      resolveGarantieFacts({ months: null, terms: '  ', termsProvided: true }),
    ).toEqual({ garantie_months: null, garantie_terms: null });
  });

  it('refuses terms sent without a duration, with a stable code', () => {
    expect(() =>
      resolveGarantieFacts({
        months: null,
        terms: 'Motorschaden ausgenommen',
        termsProvided: true,
      }),
    ).toThrow(
      expect.objectContaining({
        response: expect.objectContaining({
          code: GARANTIE_TERMS_REQUIRE_DURATION,
        }),
      }),
    );
  });

  it('clears terms that were stored earlier when the duration is removed', () => {
    expect(
      resolveGarantieFacts({
        months: null,
        terms: 'Motorschaden ausgenommen',
        termsProvided: false,
      }),
    ).toEqual({ garantie_months: null, garantie_terms: null });
  });
});
