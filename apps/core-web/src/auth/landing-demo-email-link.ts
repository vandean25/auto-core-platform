import { isSignInWithEmailLink } from 'firebase/auth'
import { firebaseAuth } from '@/lib/firebase'

/** Matches Firebase email-link flow; landing page should use the same key when storing the address. */
export const LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY = 'emailForSignIn'

import { isLandingDemoSignInGrantInvalidError } from '@/auth/landing-demo-auth-session-error'

function isDevOrE2eMagicLinkQuery(href: string): boolean {
  if (!import.meta.env.DEV && import.meta.env.MODE !== 'e2e') {
    return false
  }

  try {
    const url = new URL(href)
    return Boolean(url.searchParams.get('oobCode')) && url.searchParams.get('mode') === 'signIn'
  } catch {
    return false
  }
}

export function isFirebaseEmailLinkSignInUrl(href: string): boolean {
  if (isDevOrE2eMagicLinkQuery(href)) {
    return true
  }

  if (!firebaseAuth) {
    return false
  }

  try {
    return isSignInWithEmailLink(firebaseAuth, href)
  } catch {
    return false
  }
}

export function readStoredLandingDemoEmail(): string | null {
  if (typeof globalThis.localStorage === 'undefined') {
    return null
  }

  const stored = globalThis.localStorage.getItem(LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY)
  const trimmed = stored?.trim()
  return trimmed ? trimmed : null
}

export function storeLandingDemoEmailForSignIn(email: string): void {
  const normalized = email.trim()
  if (!normalized || typeof globalThis.localStorage === 'undefined') {
    return
  }

  globalThis.localStorage.setItem(LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY, normalized)
}

export function clearStoredLandingDemoEmail(): void {
  if (typeof globalThis.localStorage === 'undefined') {
    return
  }

  globalThis.localStorage.removeItem(LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY)
}

export function isDemoGrantSessionErrorMessage(message: string): boolean {
  return isLandingDemoSignInGrantInvalidError(new Error(message))
}

const FIREBASE_EMAIL_LINK_QUERY_KEYS = [
  'mode',
  'oobCode',
  'apiKey',
  'lang',
  'continueUrl',
  'oobLink',
] as const

export function readFirebaseAuthErrorCode(error: unknown): string {
  if (!error || typeof error !== 'object' || !('code' in error)) {
    return ''
  }

  return String((error as { code?: string }).code ?? '')
}

export function isLandingDemoEmailLinkExpiredError(error: unknown): boolean {
  const code = readFirebaseAuthErrorCode(error)
  return code === 'auth/invalid-action-code' || code === 'auth/expired-action-code'
}

export function landingDemoEmailLinkRetryMessageDe(): string {
  return 'Die Anmeldung ist fehlgeschlagen. Bitte prüfen Sie Ihre Internetverbindung und versuchen Sie es erneut.'
}

export function clearFirebaseEmailLinkQueryParams(href = globalThis.location.href): string {
  const url = new URL(href)
  for (const key of FIREBASE_EMAIL_LINK_QUERY_KEYS) {
    url.searchParams.delete(key)
  }

  const nextPath = `${url.pathname}${url.search}${url.hash}`
  globalThis.history.replaceState(globalThis.history.state, '', nextPath)
  return nextPath
}

export function describeLandingDemoEmailLinkError(error: unknown): string {
  const code = readFirebaseAuthErrorCode(error)

  if (code === 'auth/missing-email') {
    return 'Bitte geben Sie die E-Mail-Adresse ein, mit der Sie die Demo angefordert haben.'
  }

  if (isLandingDemoEmailLinkExpiredError(error)) {
    return expiredOrUsedLinkMessageDe()
  }

  if (code === 'auth/invalid-email') {
    return 'Bitte geben Sie die E-Mail-Adresse ein, mit der Sie die Demo angefordert haben.'
  }

  return landingDemoEmailLinkRetryMessageDe()
}

export function expiredOrUsedLinkMessageDe(): string {
  return 'Dieser Anmeldelink ist abgelaufen oder wurde bereits verwendet.'
}

export function resolveLandingDemoAccessUrl(): string | null {
  const configured = import.meta.env.VITE_LANDING_PAGE_URL?.trim()
  return configured || null
}
