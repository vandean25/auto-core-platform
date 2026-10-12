/** The JSON body of an API error. `code`, `orderId` and `orderNumber` appear only for the codes the API forwards. */
export type ApiErrorBody = {
    message?: string | string[]
    code?: string
    orderId?: string
    orderNumber?: string
    eventId?: string
    requestId?: string
}

export const VEHICLE_HAS_ACTIVE_ORDER_CODE = 'VEHICLE_HAS_ACTIVE_ORDER'

/**
 * Friendly copy for structured error codes. The copy keeps the order number, so callers without a
 * next-step action (such as the stock prep toast) still say which order is open. A code without an entry keeps the server message.
 */
const KNOWN_ERROR_CODE_MESSAGES: Partial<Record<string, (body: ApiErrorBody) => string>> = {
    [VEHICLE_HAS_ACTIVE_ORDER_CODE]: (body) =>
        body.orderNumber
            ? `This vehicle already has an open workshop order (${body.orderNumber}).`
            : 'This vehicle already has an open workshop order.',
}

type ApiErrorLike = {
    message?: string | string[]
    name?: string
    status?: number
    eventId?: string
    data?: ApiErrorBody
    response?: {
        status?: number
        data?: ApiErrorBody
    }
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

/** The server's error body, from an axios-style `response.data` or a `data` field. */
export function getErrorBody(error: unknown): ApiErrorBody | undefined {
    if (!isObjectLike(error)) {
        return undefined
    }

    const apiError = error as ApiErrorLike
    return apiError.response?.data ?? apiError.data
}

export function getErrorCode(error: unknown): string | undefined {
    return getErrorBody(error)?.code
}

export function getErrorMessage(error: unknown, fallbackMessage: string): string {
    if (!isObjectLike(error)) {
        return fallbackMessage
    }

    const apiError = error as ApiErrorLike
    const body = getErrorBody(error)
    const knownMessage = body?.code ? KNOWN_ERROR_CODE_MESSAGES[body.code]?.(body) : undefined
    if (knownMessage) {
        return knownMessage
    }

    const rawMessage = (
        apiError.response?.data?.message ||
        apiError.data?.message ||
        apiError.message ||
        fallbackMessage
    )
    const baseMessage = Array.isArray(rawMessage) ? rawMessage.join(', ') : rawMessage

    const status = getErrorStatus(error)
    if (status !== null && status >= 500) {
        // Keep the server's copy, or the page's fallback, and add the id the user can quote to support.
        // The global filter already writes the id into masked 5xx messages, so it is not repeated.
        const body = getErrorBody(error)
        const reference = body?.requestId || body?.eventId || apiError.eventId
        if (!reference || baseMessage.includes('(ref: ')) {
            return baseMessage
        }
        return `${baseMessage} (ref: ${reference})`
    }

    const eventId =
        apiError.response?.data?.eventId ||
        apiError.data?.eventId ||
        apiError.eventId

    if (!eventId) {
        return baseMessage
    }

    return `${baseMessage} (Error ID: ${eventId})`
}

export function getErrorStatus(error: unknown): number | null {
    if (!isObjectLike(error)) {
        return null
    }

    const apiError = error as ApiErrorLike
    return apiError.response?.status ?? apiError.status ?? null
}

export function isAbortError(error: unknown): boolean {
    if (!isObjectLike(error)) {
        return false
    }

    const apiError = error as ApiErrorLike
    return apiError.name === 'AbortError'
}

/**
 * Creates an Error instance with an attached `.status` property so callers
 * can detect specific HTTP error codes (e.g. 409 Conflict) without parsing
 * the message string.
 *
 * Usage:
 *   throw createHttpError('Task already locked', 409)
 */
export function createHttpError(message: string, status: number): Error & { status: number } {
    const err = new Error(message) as Error & { status: number }
    err.status = status
    return err
}
