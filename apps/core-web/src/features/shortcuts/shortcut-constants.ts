/** Time window for G-then-letter navigation sequences (AUT-694 D4). */
export const G_SEQUENCE_TIMEOUT_MS = 1000

/** Keys the shared dispatcher owns; no registry `shortcutKey` may reuse them (ADR-0036 R5). */
export const RESERVED_SINGLE_KEYS: readonly string[] = ['j', 'k', 'x', 'g', '?']

/** Keys the shared data table handles in the `row` scope (focus movement and selection). */
export const DATA_TABLE_ROW_KEYS: readonly string[] = ['j', 'k', 'x']

/** Plain keys handled in the `global` scope (fresh-page row entry, shortcut sheet, g-sequence prefix). */
export const GLOBAL_PLAIN_KEYS: readonly string[] = ['j', '?', 'g']
