import { isSignInWithEmailLink } from 'firebase/auth'
import { firebaseAuth } from '@/lib/firebase'

/** Matches Firebase email-link flow; landing page should use the same key when storing the address. */
export const LANDING_DEMO_EMAIL_FOR_SIGN_IN_STORAGE_KEY = 'emailForSignIn'

const DEMO_GRANT_SESSION_ERROR_EN =
  'Demo sign-in link is missing, expired, or already used.'

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
  return message.includes(DEMO_GRANT_SESSION_ERROR_EN)
}

export function describeLandingDemoEmailLinkError(error: unknown): string {
  const code =
    error && typeof error === 'object' && 'code' in error
      ? String((error as { code?: string }).code ?? '')
      : ''

  if (code === 'auth/missing-email') {
    return 'Bitte geben Sie die E-Mail-Adresse ein, mit der Sie die Demo angefordert haben.'
  }

  if (
    code === 'auth/invalid-action-code' ||
    code === 'auth/expired-action-code' ||
    code === 'auth/invalid-email'
  ) {
    return expiredOrUsedLinkMessageDe()
  }

  return expiredOrUsedLinkMessageDe()
}

export function expiredOrUsedLinkMessageDe(): string {
  return 'Dieser Anmeldelink ist abgelaufen oder wurde bereits verwendet.'
}

export function demoGrantSessionRejectedMessageDe(): string {
  return expiredOrUsedLinkMessageDe()
}

export function resolveLandingDemoAccessUrl(): string | null {
  const configured = import.meta.env.VITE_LANDING_PAGE_URL?.trim()
  return configured || null
}
