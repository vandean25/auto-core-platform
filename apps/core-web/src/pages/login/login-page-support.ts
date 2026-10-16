const DEMO_HOSTNAME = 'auto-core-platform-vande.web.app'

export const LOGIN_HIGHLIGHT_KEYS = ['parts', 'jobs', 'invoices'] as const

export function isDemoHost() {
  return typeof globalThis.location !== 'undefined' && globalThis.location.hostname === DEMO_HOSTNAME
}

export function describeAuthError(error: unknown, fallback: string) {
  if (error !== undefined && error !== null) {
    console.warn('[login] auth error', error)
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
