import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { isServiceWorkerEnabled, registerServiceWorker, updateServiceWorker } from './register-service-worker'

const register = vi.fn().mockResolvedValue({})
const update = vi.fn().mockResolvedValue(undefined)
const getRegistration = vi.fn().mockResolvedValue({ update })

beforeEach(() => {
  vi.stubEnv('MODE', 'production')
  vi.stubEnv('VITE_APP_VERSION', 'v1.2.3')
  Object.defineProperty(navigator, 'serviceWorker', {
    configurable: true,
    value: { register, getRegistration },
  })
})

afterEach(() => {
  vi.unstubAllEnvs()
  vi.clearAllMocks()
})

describe('service worker registration', () => {
  it('registers /sw.js at the root scope, always checking the network for a new worker file', () => {
    registerServiceWorker()

    expect(register).toHaveBeenCalledWith('/sw.js', { scope: '/', updateViaCache: 'none' })
  })

  it.each([
    ['the dev server', 'development', 'v1.2.3'],
    ['the e2e build', 'e2e', 'v1.0.0-e2e'],
    ['a production build without a release version', 'production', ''],
    ['a production build with a blank release version', 'production', '  '],
  ])('does not register in %s', (_label, mode, version) => {
    vi.stubEnv('MODE', mode)
    vi.stubEnv('VITE_APP_VERSION', version)

    registerServiceWorker()

    expect(isServiceWorkerEnabled()).toBe(false)
    expect(register).not.toHaveBeenCalled()
  })

  it('looks for a new worker file on update and never throws', async () => {
    await updateServiceWorker()
    expect(update).toHaveBeenCalledTimes(1)

    update.mockRejectedValueOnce(new Error('offline'))
    await expect(updateServiceWorker()).resolves.toBeUndefined()
  })

  it('does not touch the registration where the worker is disabled', async () => {
    vi.stubEnv('MODE', 'development')

    await updateServiceWorker()

    expect(getRegistration).not.toHaveBeenCalled()
  })
})
