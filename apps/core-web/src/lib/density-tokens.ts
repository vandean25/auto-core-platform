/**
 * DataTable row-density tokens (ADR-0036).
 *
 * Comfortable is the base `Table` metric (`p-3` cells, `h-11` header), so it needs
 * no rule of its own: only the compact values exist, and the grid applies them only
 * while compact density is active. `:where()` keeps the descendant out of the
 * selector's specificity, so these rules stay at plain-utility weight instead of
 * outranking a cell's own classes.
 */
export type DataTableDensity = 'comfortable' | 'compact'

export const densityTokens = {
  compactRowClass: '[&_:where(td)]:py-1.5',
  compactHeaderClass: '[&_:where(th)]:h-9',
} as const
