import { translateApiError } from './api-error'

type NestErrorPayload = {
  code?: string
  message?: string | string[]
  statusCode?: number
  error?: string
}

export function formatNestApiErrorMessage(
  payload: NestErrorPayload,
  fallbackMessage: string,
): string {
  if (payload.code) {
    return translateApiError(
      { response: { status: payload.statusCode ?? 400, data: payload } },
      'errors:generic.unexpected',
    )
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
