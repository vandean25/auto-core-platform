/**
 * Digits-only customer phone key for global search (AUT-698).
 *
 * Rule: strip non-digits; `+43` / `0043` become Austrian national `0…`;
 * other `00<cc>` international prefixes drop the leading `00` and keep the rest.
 */
export function normalizePhone(
  value: string | null | undefined,
): string | null {
  const digits = (value ?? '').replace(/\D/g, '');
  if (!digits) {
    return null;
  }
  if (digits.startsWith('0043')) {
    return `0${digits.slice(4)}`;
  }
  if (digits.startsWith('43') && digits.length > 2) {
    return `0${digits.slice(2)}`;
  }
  if (digits.startsWith('00')) {
    return digits.slice(2);
  }
  return digits;
}

/**
 * Every customer write that sets `phone` runs its data through this, so `phone_digits`
 * cannot drift. Data that does not write the phone is returned as is.
 */
export function withPhoneDigits<T extends { phone?: unknown }>(
  data: T,
): T & { phone_digits?: string | null } {
  const { phone } = data;
  if (phone === undefined) {
    return data;
  }
  const value =
    phone !== null && typeof phone === 'object' && 'set' in phone
      ? phone.set
      : phone;
  return {
    ...data,
    phone_digits: normalizePhone(typeof value === 'string' ? value : null),
  };
}
