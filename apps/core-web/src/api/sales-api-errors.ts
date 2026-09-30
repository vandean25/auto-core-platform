type NestErrorPayload = {
  code?: string
  message?: string | string[]
  statusCode?: number
  error?: string
}

const FRIENDLY_NEST_ERROR_MESSAGES: Record<string, string> = {
  INVOICE_BRANDING_WRITER_DISABLED:
    'Branded invoice issuance is disabled in this environment. Finalize and print will work after operations enable the invoice branding writer.',
}

export function formatNestApiErrorMessage(
  payload: NestErrorPayload,
  fallbackMessage: string,
): string {
  const friendlyByCode =
    payload.code ? FRIENDLY_NEST_ERROR_MESSAGES[payload.code] : undefined
  if (friendlyByCode) {
    return friendlyByCode
  }

  const rawMessage = payload.message
  const message =
    typeof rawMessage === 'undefined'
      ? undefined
      : Array.isArray(rawMessage)
        ? rawMessage.join(', ')
        : rawMessage

  if (payload.code && message) {
    return `${payload.code}: ${message}`
  }
  if (message) {
    return message
  }
  if (payload.code) {
    return payload.code
  }
  if (payload.error && payload.error !== 'Bad Request') {
    return payload.error
  }
  return fallbackMessage
}

export async function readNestApiErrorMessage(
  response: Response,
  fallbackMessage: string,
): Promise<string> {
  const payload = (await response.json().catch(() => ({}))) as NestErrorPayload
  return formatNestApiErrorMessage(payload, fallbackMessage)
}

export async function throwIfSalesResponseNotOk(
  response: Response,
  fallbackMessage: string,
): Promise<void> {
  if (response.ok) return
  const message = await readNestApiErrorMessage(response, fallbackMessage)
  throw new Error(message)
}
