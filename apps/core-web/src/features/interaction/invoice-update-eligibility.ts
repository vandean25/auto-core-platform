/**
 * ADR-0036 R1 eligibility for a sales-invoice draft save (AUT-896).
 * Optimistic only for a non-empty set of note fields. Prices, tax, the customer and the lines stay server-confirmed,
 * because the server recalculates totals and the draft is not a note-only contract.
 */

const INVOICE_OPTIMISTIC_FIELDS: ReadonlySet<string> = new Set(['notes', 'internalNotes'])

export function isInvoiceUpdateOptimisticEligible({
  changedFields,
}: {
  changedFields?: readonly string[]
}): boolean {
  return (
    changedFields !== undefined &&
    changedFields.length > 0 &&
    changedFields.every((field) => INVOICE_OPTIMISTIC_FIELDS.has(field))
  )
}
