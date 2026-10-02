export function isE2EAuthBypassEnabled() {
  return import.meta.env.MODE !== 'production' && import.meta.env.VITE_E2E_SKIP_AUTH === 'true'
}

/** Full-stack Playwright: real API auth via a locally signed test JWT (non-production only). */
export function isE2ETestTokenAuthEnabled() {
  if (import.meta.env.MODE === 'production') {
    return false
  }

  const token = import.meta.env.VITE_E2E_TEST_TOKEN
  return typeof token === 'string' && token.trim().length > 0
}

export function getE2ETestToken() {
  if (!isE2ETestTokenAuthEnabled()) {
    return null
  }

  return import.meta.env.VITE_E2E_TEST_TOKEN.trim()
}