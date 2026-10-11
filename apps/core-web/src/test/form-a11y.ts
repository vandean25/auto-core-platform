import { expect } from 'vitest'

/**
 * Asserts an inline validation error is wired to its field: the control is marked
 * `aria-invalid="true"` and `aria-describedby` references an element whose text is `message`.
 */
export function expectFieldErrorLinked(field: HTMLElement, message: string) {
  expect(field).toHaveAttribute('aria-invalid', 'true')

  const describedBy = field.getAttribute('aria-describedby') ?? ''
  const linkedText = describedBy
    .split(/\s+/)
    .filter(Boolean)
    .map((id) => document.getElementById(id)?.textContent ?? '')

  expect(linkedText, `aria-describedby="${describedBy}" should reference "${message}"`).toContain(message)
}

/** Asserts a control has no validation error: `aria-invalid="false"` and no error reference. */
export function expectFieldValid(field: HTMLElement) {
  expect(field).toHaveAttribute('aria-invalid', 'false')
  expect(field).not.toHaveAttribute('aria-describedby')
}
