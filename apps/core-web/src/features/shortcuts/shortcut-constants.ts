/** Time window for G-then-letter navigation sequences (AUT-694 D4). */
export const G_SEQUENCE_TIMEOUT_MS = 1000

/** Keys the shared dispatcher owns; no registry `shortcutKey` may reuse them (ADR-0036 R5). */
export const RESERVED_SINGLE_KEYS: readonly string[] = ['j', 'k', 'x', 'g', '?']
