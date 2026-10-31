/**
 * Full-stack Playwright harness auth seam (non-production, `VITE_E2E_TEST_TOKEN` only). The harness has no Firebase,
 * so the sign-in form cannot switch users. Dispatching `acp:e2e-test-sign-in` on `window` with an identity signs the
 * shell in as that user through the regular uid-change path.
 */

export type E2ETestTokenIdentity = {
  uid: string
  email: string | null
  displayName: string | null
  claims?: Record<string, unknown>
}

export const E2E_TEST_SIGN_IN_EVENT = 'acp:e2e-test-sign-in'

export const DEFAULT_E2E_TEST_TOKEN_IDENTITY: E2ETestTokenIdentity = {
  uid: 'e2e-fullstack-user',
  email: 'e2e-fullstack@auto.core.test',
  displayName: 'E2E Fullstack',
}
