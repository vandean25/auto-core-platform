import { phoneDigitTailContainsVariants } from './customer-duplicate-check.phone-probe.js';
import {
  normalizeMatchPhone,
  normalizeMatchVatId,
} from './customer-match.util.js';

const MIN_PHONE_DIGIT_TAIL = 6;

/**
 * Broad phone probe filter: matches rows whose stored spelling may differ only
 * by spaces or a +43 / 0 prefix. Post-filter with `normalizeMatchPhone`.
 */
export function buildPhoneCandidateWhere(
  tenantId: string,
  phone: string | null | undefined,
): { tenant_id: string; phone: { not: null }; OR: object[] } | null {
  const national = normalizeMatchPhone(phone);
  if (!national) {
    return null;
  }
  const tail =
    national.length >= MIN_PHONE_DIGIT_TAIL
      ? national.slice(-MIN_PHONE_DIGIT_TAIL)
      : national;
  const tailVariants = phoneDigitTailContainsVariants(tail);
  return {
    tenant_id: tenantId,
    phone: { not: null },
    OR: [
      { phone: { contains: national, mode: 'insensitive' as const } },
      ...tailVariants.map((variant) => ({
        phone: { contains: variant, mode: 'insensitive' as const },
      })),
    ],
  };
}

/**
 * Broad UID probe filter: matches rows whose stored spelling may include spaces.
 * Post-filter with `normalizeMatchVatId`.
 */
export function buildVatIdCandidateWhere(
  tenantId: string,
  vatId: string | null | undefined,
): { tenant_id: string; vat_id: { not: null }; OR: object[] } | null {
  const normalized = normalizeMatchVatId(vatId);
  if (!normalized) {
    return null;
  }
  const tail = normalized.length >= 8 ? normalized.slice(-8) : normalized;
  return {
    tenant_id: tenantId,
    vat_id: { not: null },
    OR: [
      { vat_id: { contains: normalized, mode: 'insensitive' as const } },
      { vat_id: { contains: tail, mode: 'insensitive' as const } },
    ],
  };
}
