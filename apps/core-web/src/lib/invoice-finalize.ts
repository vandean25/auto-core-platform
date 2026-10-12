import type { DocumentSaveStatus } from '@/hooks/useDebouncedAutoSave'

export const FINALIZE_MISSING_CUSTOMER_MESSAGE =
  'Invoice draft is missing required customer information.'
export const FINALIZE_SAVING_MESSAGE =
  'Please wait for the draft to finish saving before finalizing.'
export const FINALIZE_AUTOSAVE_ERROR_MESSAGE =
  'Resolve the autosave error before finalizing this invoice.'
export const FINALIZE_NOT_NUMBERED_MESSAGE =
  'Invoice finalize did not return a finalized document with an invoice number.'

/**
 * The message to show when the draft cannot be finalized yet, or null when
 * finalize may proceed.
 */
export function getInvoiceFinalizeBlockMessage({
  hasCustomer,
  saveStatus,
}: {
  hasCustomer: boolean
  saveStatus: DocumentSaveStatus
}): string | null {
  if (!hasCustomer) return FINALIZE_MISSING_CUSTOMER_MESSAGE
  if (saveStatus === 'saving') return FINALIZE_SAVING_MESSAGE
  if (saveStatus === 'error') return FINALIZE_AUTOSAVE_ERROR_MESSAGE
  return null
}

/** Throws unless the finalize response is a FINALIZED invoice with its RE number. */
export function assertFinalizedInvoice(finalized: {
  status: string
  invoice_number?: string | null
}): void {
  if (finalized.status !== 'FINALIZED' || !finalized.invoice_number) {
    throw new Error(FINALIZE_NOT_NUMBERED_MESSAGE)
  }
}
