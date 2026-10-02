import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  getE2ETestToken,
  isE2EAuthBypassEnabled,
  isE2ETestTokenAuthEnabled,
} from './runtime-flags'

describe('runtime-flags', () => {
  afterEach(() => {
    vi.unstubAllEnvs()
  })

  it('does not enable test-token auth in production builds', () => {
    vi.stubEnv('MODE', 'production')
    vi.stubEnv('VITE_E2E_TEST_TOKEN', 'signed-test-jwt-token')

    expect(isE2ETestTokenAuthEnabled()).toBe(false)
    expect(getE2ETestToken()).toBeNull()
  })

  it('enables test-token auth only outside production when a token is configured', () => {
    vi.stubEnv('MODE', 'test')
    vi.stubEnv('VITE_E2E_TEST_TOKEN', 'signed-test-jwt-token')

    expect(isE2ETestTokenAuthEnabled()).toBe(true)
    expect(getE2ETestToken()).toBe('signed-test-jwt-token')
  })

  it('keeps mocked skip-auth separate from test-token auth', () => {
    vi.stubEnv('MODE', 'test')
    vi.stubEnv('VITE_E2E_SKIP_AUTH', 'true')
    vi.stubEnv('VITE_E2E_TEST_TOKEN', 'signed-test-jwt-token')

    expect(isE2EAuthBypassEnabled()).toBe(true)
    expect(isE2ETestTokenAuthEnabled()).toBe(true)
  })
})
