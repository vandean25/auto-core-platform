type HtmlInputMode = 'none' | 'text' | 'tel' | 'url' | 'email' | 'numeric' | 'decimal' | 'search' | undefined

/** Default inputMode for native number inputs (iOS numeric keyboard, no focus zoom side effects). */
export function resolveNumberInputMode(
  type?: string,
  step?: string | number,
  explicit?: HtmlInputMode,
): HtmlInputMode {
  if (explicit) return explicit
  if (type !== 'number') return undefined

  if (step === undefined || step === 'any') return 'decimal'

  const stepValue = typeof step === 'string' ? Number.parseFloat(step) : step
  if (Number.isFinite(stepValue) && stepValue === 1) return 'numeric'

  return 'decimal'
}
