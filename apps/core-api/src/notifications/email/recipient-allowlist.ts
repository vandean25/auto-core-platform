import { isPlainEmailAddress } from './email-address.js';

/**
 * Live sends only reach allowlisted recipients (ADR-0025 §6, AUT-356 R12). Entries are exact
 * addresses or `*@domain` (the domain itself, no subdomains). An empty list sends nothing.
 */
export function parseRecipientAllowlist(raw: string | undefined): string[] {
  if (!raw) {
    return [];
  }
  return raw
    .split(',')
    .map((entry) => entry.trim().toLowerCase())
    .filter((entry) => entry.length > 0);
}

/** Entries that are neither an address nor `*@domain`. Used by env validation so a typo fails boot. */
export function findInvalidAllowlistEntries(
  entries: readonly string[],
): string[] {
  return entries.filter(
    (entry) =>
      !isPlainEmailAddress(
        entry.startsWith('*@') ? `x${entry.slice(1)}` : entry,
      ),
  );
}

/** A recipient that is not one plain address is never allowlisted, even if it contains a listed domain. */
export function isRecipientAllowlisted(
  email: string,
  allowlist: readonly string[],
): boolean {
  const address = email.trim().toLowerCase();
  if (!isPlainEmailAddress(address)) {
    return false;
  }
  const domain = address.slice(address.lastIndexOf('@') + 1);
  return allowlist.some((entry) =>
    entry.startsWith('*@') ? entry.slice(2) === domain : entry === address,
  );
}
