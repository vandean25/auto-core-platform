import deErrors from '../../../../locales/de/errors.json' with { type: 'json' }

/** German `errors.codes.*` strings (default locale `de`). */
export const DE_ERROR_CODES = deErrors.codes as Record<string, string>

export function deErrorCode(code: string): string {
  const message = DE_ERROR_CODES[code]
  if (!message) {
    throw new Error(`Missing German translation for errors.codes.${code}`)
  }
  return message
}
