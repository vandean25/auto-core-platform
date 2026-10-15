import { signInWithEmailLink } from 'firebase/auth'
import {
  clearStoredLandingDemoEmail,
  storeLandingDemoEmailForSignIn,
} from '@/auth/landing-demo-email-link'
import { firebaseAuth } from '@/lib/firebase'

export async function completeLandingDemoEmailLinkSignIn(
  email: string,
  emailLinkUrl: string,
): Promise<void> {
  if (!firebaseAuth) {
    throw new Error('Firebase Authentication is not configured.')
  }

  const normalizedEmail = email.trim()
  if (!normalizedEmail) {
    throw new Error('Email is required.')
  }

  storeLandingDemoEmailForSignIn(normalizedEmail)
  await signInWithEmailLink(firebaseAuth, normalizedEmail, emailLinkUrl)
  clearStoredLandingDemoEmail()
}
