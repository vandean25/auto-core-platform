export type ImportPriceJumpRow = {
  normalized?: unknown
  warnings?: unknown
}

type ImportPriceJumpWarning = {
  code?: string
  message?: string
}

/** True when a dry-run row was flagged for a price jump above the configured threshold. */
export function isRowPriceJump(row: ImportPriceJumpRow): boolean {
  const normalized = row.normalized as Record<string, unknown> | null
  const warnings = (row.warnings ?? []) as ImportPriceJumpWarning[]
  return (
    normalized?.price_jump_flagged === true ||
    warnings.some(
      (warning) =>
        warning.code === 'PRICE_JUMP_EXCEEDED' ||
        (typeof warning.message === 'string' &&
          warning.message.toLowerCase().includes('preissprung')),
    )
  )
}
