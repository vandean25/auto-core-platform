import { UnprocessableEntityException } from '@nestjs/common';

export const GARANTIE_TERMS_REQUIRE_DURATION =
  'GARANTIE_TERMS_REQUIRE_DURATION';

/**
 * Garantie terms only apply with a duration, so a sale never stores terms
 * without one. Terms sent without a duration are refused. Terms stored earlier
 * are cleared when the duration is removed.
 */
export function resolveGarantieFacts(input: {
  months: number | null;
  terms: string | null;
  termsProvided: boolean;
}): { garantie_months: number | null; garantie_terms: string | null } {
  const terms = input.terms?.trim() ? input.terms.trim() : null;
  if (input.months === null) {
    if (terms !== null && input.termsProvided) {
      throw new UnprocessableEntityException({
        code: GARANTIE_TERMS_REQUIRE_DURATION,
        message: 'Garantiebedingungen setzen eine Garantiedauer voraus.',
      });
    }
    return { garantie_months: null, garantie_terms: null };
  }
  return { garantie_months: input.months, garantie_terms: terms };
}
