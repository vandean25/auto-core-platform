/**
 * The advisor's confirmation that a customer's address is for order communication covers one address (ADR-0025 §8).
 * Every write that changes the address withdraws it, unless the same write sets the flag. Returns `false` when the
 * write must withdraw the confirmation, and `undefined` when it leaves the flag alone.
 */
export function confirmationAfterEmailWrite(
  currentEmail: string | null,
  write: { email?: unknown; contact_email_ok?: unknown },
): false | undefined {
  if (write.email === undefined || write.contact_email_ok !== undefined) {
    return undefined;
  }
  const nextEmail = typeof write.email === 'string' ? write.email : null;
  return nextEmail === currentEmail ? undefined : false;
}
