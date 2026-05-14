type ApiErrorLike = {
    message?: string
    name?: string
    status?: number
    eventId?: string
    data?: {
        message?: string
        eventId?: string
    }
    response?: {
        status?: number
        data?: {
            message?: string
            eventId?: string
        }
    }
}

function isObjectLike(value: unknown): value is Record<string, unknown> {
    return typeof value === 'object' && value !== null
}

export function getErrorMessage(error: unknown, fallbackMessage: string): string {
    if (!isObjectLike(error)) {
        return fallbackMessage
    }

    const apiError = error as ApiErrorLike
    const baseMessage = (
        apiError.response?.data?.message ||
        apiError.data?.message ||
        apiError.message ||
        fallbackMessage
    )
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
