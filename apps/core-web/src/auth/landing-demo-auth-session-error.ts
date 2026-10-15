export const LANDING_DEMO_SIGN_IN_GRANT_INVALID_CODE = 'LANDING_DEMO_SIGN_IN_GRANT_INVALID'

const LEGACY_DEMO_GRANT_SESSION_ERROR_EN =
  'Demo sign-in link is missing, expired, or already used.'

export class LandingDemoAuthSessionError extends Error {
  readonly code: string | undefined

  constructor(message: string, code?: string) {
    super(message)
    this.name = 'LandingDemoAuthSessionError'
    this.code = code
  }
}

export function isLandingDemoSignInGrantInvalidError(error: unknown): boolean {
  if (error instanceof LandingDemoAuthSessionError) {
    return error.code === LANDING_DEMO_SIGN_IN_GRANT_INVALID_CODE
  }

  if (error && typeof error === 'object' && 'code' in error) {
    return (error as { code?: string }).code === LANDING_DEMO_SIGN_IN_GRANT_INVALID_CODE
  }

  const message = error instanceof Error ? error.message : ''
  return message.includes(LEGACY_DEMO_GRANT_SESSION_ERROR_EN)
}
