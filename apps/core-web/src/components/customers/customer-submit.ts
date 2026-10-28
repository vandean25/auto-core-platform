import type { TFunction } from 'i18next'
import type { UseFormSetError } from 'react-hook-form'
import { getBadRequestFields } from '@/api/api-error'
import type { Customer } from '@/api/types'

/**
 * The body to send for the customer form. The e-mail is optional: a blank field means no address (null clears it on an
 * edit, a new customer just has none). A changed address withdraws the advisor's confirmation (ADR-0025 §8), so the
 * flag is not sent as true then.
 */
export function buildCustomerPayload(formData: Partial<Customer>, existing?: Customer): Partial<Customer> {
  const email = formData.email?.trim() ?? ''
  const payload: Partial<Customer> = { ...formData, email: email || (existing ? null : undefined) }
  return existing && email !== (existing.email ?? '') ? { ...payload, contact_email_ok: false } : payload
}

/** Marks the fields a 400 refused on the form and returns how many it marked (0: the error names no form field). */
export function markRefusedFields(
  error: unknown,
  fieldNames: readonly string[],
  setError: UseFormSetError<Partial<Customer>>,
  t: TFunction<'customers'>,
): number {
  const refused = getBadRequestFields(error).filter((field): field is keyof Customer & string => fieldNames.includes(field))
  refused.forEach((field) =>
    setError(field, { type: 'server', message: t(field === 'email' ? 'dialog.errors.email' : 'dialog.errors.invalid') }),
  )
  return refused.length
}
