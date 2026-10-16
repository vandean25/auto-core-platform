const DEMO_HOSTNAME = 'auto-core-platform-vande.web.app'

export const LOGIN_HIGHLIGHT_KEYS = ['parts', 'jobs', 'invoices'] as const

export function isDemoHost() {
  return typeof globalThis.location !== 'undefined' && globalThis.location.hostname === DEMO_HOSTNAME
}

export function describeAuthError(error: unknown, fallback: string) {
  if (error && typeof error === 'object') {
    const details = [
      ['name', 'name' in error ? String((error as { name?: string }).name ?? '') : ''],
      ['code', 'code' in error ? String((error as { code?: string }).code ?? '') : ''],
      ['message', 'message' in error ? String((error as { message?: string }).message ?? '') : ''],
    ]
      .filter(([, value]) => value)
      .map(([key, value]) => `${key}=${value}`)

    if (details.length > 0) {
      return `${fallback} (${details.join(', ')})`
    }
  }

  return fallback
}

export type LoginValidationKey =
  | 'login.validation.bothRequired'
  | 'login.validation.emailRequired'
  | 'login.validation.passwordRequired'

export function getLoginValidationErrorKey(email: string, password: string): LoginValidationKey | null {
  const trimmedEmail = email.trim()

  if (!trimmedEmail && !password) {
    return 'login.validation.bothRequired'
  }

  if (!trimmedEmail) {
    return 'login.validation.emailRequired'
  }

  if (!password) {
    return 'login.validation.passwordRequired'
  }

  return null
}
