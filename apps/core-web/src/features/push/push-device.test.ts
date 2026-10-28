import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

const mocks = vi.hoisted(() => ({
  registerPushDevice: vi.fn(),
  revokePushDevice: vi.fn(),
  getToken: vi.fn(),
  deleteToken: vi.fn(),
  getMessaging: vi.fn(() => ({ messaging: true })),
  vapidKey: 'public-vapid-key',
  serviceWorkerEnabled: true,
}))

vi.mock('@/api/push', () => ({
  registerPushDevice: mocks.registerPushDevice,
  revokePushDevice: mocks.revokePushDevice,
}))
vi.mock('firebase/messaging', () => ({
  getMessaging: mocks.getMessaging,
  getToken: mocks.getToken,
  deleteToken: mocks.deleteToken,
}))
vi.mock('@/lib/firebase', () => ({
  firebaseApp: { name: 'app' },
  get pushVapidKey() {
    return mocks.vapidKey
  },
}))
vi.mock('@/pwa/register-service-worker', () => ({ isServiceWorkerEnabled: () => mocks.serviceWorkerEnabled }))

import {
  PushPermissionError,
  disablePushOnThisDevice,
  enablePushOnThisDevice,
  getPushSupport,
  getStoredDeviceId,
  keepPushRegistrationAlive,
  releasePushRegistration,
  switchTenantWithPush,
} from './push-device'

const DESKTOP_CHROME = 'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/130.0 Safari/537.36'
const IPHONE = 'Mozilla/5.0 (iPhone; CPU iPhone OS 17_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.5 Mobile/15E148 Safari/604.1'

function setup(options: { userAgent?: string; standalone?: boolean; permission?: NotificationPermission; request?: NotificationPermission } = {}) {
  vi.stubGlobal('navigator', {
    userAgent: options.userAgent ?? DESKTOP_CHROME,
    platform: 'Linux',
    maxTouchPoints: 0,
    serviceWorker: { ready: Promise.resolve({ scope: '/' }) },
  })
  vi.stubGlobal('PushManager', class {})
  const requestPermission = vi.fn(async () => options.request ?? 'granted')
  vi.stubGlobal('Notification', { permission: options.permission ?? 'default', requestPermission })
  window.matchMedia = vi.fn(() => ({ matches: options.standalone ?? false })) as unknown as typeof window.matchMedia
  return { requestPermission }
}

describe('push on this device', () => {
  beforeEach(() => {
    window.localStorage.clear()
    mocks.vapidKey = 'public-vapid-key'
    mocks.serviceWorkerEnabled = true
    mocks.registerPushDevice.mockReset().mockResolvedValue({ id: 'device-1' })
    mocks.revokePushDevice.mockReset().mockResolvedValue(undefined)
    mocks.getToken.mockReset().mockResolvedValue('fcm-token')
    mocks.deleteToken.mockReset().mockResolvedValue(true)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
  })

  describe('getPushSupport', () => {
    it('is off without a VAPID key, whatever the browser can do', () => {
      setup()
      mocks.vapidKey = ''
      expect(getPushSupport()).toBe('off')
    })

    it('is ready in a browser with the push APIs and the service worker', () => {
      setup()
      expect(getPushSupport()).toBe('ready')
    })

    it('asks iPhone users to install the app first, and is ready once installed', () => {
      setup({ userAgent: IPHONE })
      expect(getPushSupport()).toBe('install-required')
      setup({ userAgent: IPHONE, standalone: true })
      expect(getPushSupport()).toBe('ready')
    })

    it('is unsupported without the service worker (dev server, e2e build) or the push API', () => {
      setup()
      mocks.serviceWorkerEnabled = false
      expect(getPushSupport()).toBe('unsupported')
      mocks.serviceWorkerEnabled = true
      vi.stubGlobal('PushManager', undefined)
      delete (window as { PushManager?: unknown }).PushManager
      expect(getPushSupport()).toBe('unsupported')
    })
  })

  describe('enablePushOnThisDevice', () => {
    it('asks for the permission, gets the token for the existing service worker and registers the browser', async () => {
      const { requestPermission } = setup({ standalone: true })

      await enablePushOnThisDevice()

      expect(requestPermission).toHaveBeenCalledTimes(1)
      expect(mocks.getToken).toHaveBeenCalledWith(
        { messaging: true },
        { vapidKey: 'public-vapid-key', serviceWorkerRegistration: { scope: '/' } },
      )
      expect(mocks.registerPushDevice).toHaveBeenCalledWith({
        token: 'fcm-token',
        platform: 'DESKTOP',
        browser: 'chrome',
        installed: true,
      })
      expect(getStoredDeviceId()).toBe('device-1')
    })

    it('registers nothing when the permission is not granted', async () => {
      setup({ request: 'denied' })

      await expect(enablePushOnThisDevice()).rejects.toBeInstanceOf(PushPermissionError)

      expect(mocks.getToken).not.toHaveBeenCalled()
      expect(mocks.registerPushDevice).not.toHaveBeenCalled()
      expect(getStoredDeviceId()).toBeNull()
    })
  })

  describe('never prompts', () => {
    it('keepPushRegistrationAlive and the tenant switch never ask for the permission', async () => {
      const { requestPermission } = setup({ permission: 'granted' })
      window.localStorage.setItem('acp.push.registration', 'device-1')

      await keepPushRegistrationAlive()
      await switchTenantWithPush(async () => 'switched')

      expect(requestPermission).not.toHaveBeenCalled()
    })

    it('does not register again while the permission is not granted', async () => {
      setup({ permission: 'default' })
      window.localStorage.setItem('acp.push.registration', 'device-1')

      await keepPushRegistrationAlive()

      expect(mocks.registerPushDevice).not.toHaveBeenCalled()
    })
  })

  describe('keepPushRegistrationAlive', () => {
    it('registers again at most once a day, and only a browser that was registered', async () => {
      setup({ permission: 'granted' })
      vi.useFakeTimers()
      try {
        vi.setSystemTime(new Date('2026-10-28T08:00:00Z'))
        await keepPushRegistrationAlive()
        expect(mocks.registerPushDevice).not.toHaveBeenCalled()

        window.localStorage.setItem('acp.push.registration', 'device-1')
        await keepPushRegistrationAlive()
        expect(mocks.registerPushDevice).toHaveBeenCalledTimes(1)

        vi.setSystemTime(new Date('2026-10-28T20:00:00Z'))
        await keepPushRegistrationAlive()
        expect(mocks.registerPushDevice).toHaveBeenCalledTimes(1)

        vi.setSystemTime(new Date('2026-10-29T09:00:00Z'))
        await keepPushRegistrationAlive()
        expect(mocks.registerPushDevice).toHaveBeenCalledTimes(2)
      } finally {
        vi.useRealTimers()
      }
    })
  })

  describe('removing the registration', () => {
    it('disablePushOnThisDevice revokes the device, forgets it and deletes the token', async () => {
      setup({ permission: 'granted' })
      window.localStorage.setItem('acp.push.registration', 'device-1')

      await disablePushOnThisDevice()

      expect(mocks.revokePushDevice).toHaveBeenCalledWith('device-1')
      expect(mocks.deleteToken).toHaveBeenCalled()
      expect(getStoredDeviceId()).toBeNull()
    })

    it('releasePushRegistration does nothing for a browser without a registration', async () => {
      setup({ permission: 'granted' })
      await expect(releasePushRegistration()).resolves.toBe(false)
      expect(mocks.revokePushDevice).not.toHaveBeenCalled()
    })

    it('releasePushRegistration never blocks on a failing server', async () => {
      setup({ permission: 'granted' })
      window.localStorage.setItem('acp.push.registration', 'device-1')
      mocks.revokePushDevice.mockRejectedValue(new Error('offline'))

      await expect(releasePushRegistration()).resolves.toBe(true)
      expect(getStoredDeviceId()).toBeNull()
    })
  })

  describe('switchTenantWithPush', () => {
    it('removes the registration of the old tenant, switches, then registers again for the new one', async () => {
      setup({ permission: 'granted' })
      window.localStorage.setItem('acp.push.registration', 'device-old')
      const order: string[] = []
      mocks.revokePushDevice.mockImplementation(async () => void order.push('revoke'))
      mocks.registerPushDevice.mockImplementation(async () => {
        order.push('register')
        return { id: 'device-new' }
      })

      await switchTenantWithPush(async () => void order.push('switch'))

      expect(order).toEqual(['revoke', 'switch', 'register'])
      expect(getStoredDeviceId()).toBe('device-new')
    })

    it('puts the registration back when the switch fails, and passes the error on', async () => {
      setup({ permission: 'granted' })
      window.localStorage.setItem('acp.push.registration', 'device-old')

      await expect(switchTenantWithPush(() => Promise.reject(new Error('refused')))).rejects.toThrow('refused')

      expect(mocks.registerPushDevice).toHaveBeenCalledTimes(1)
      expect(getStoredDeviceId()).toBe('device-1')
    })

    it('does nothing extra for a browser without push', async () => {
      setup({ permission: 'granted' })
      await switchTenantWithPush(async () => 'ok')
      expect(mocks.revokePushDevice).not.toHaveBeenCalled()
      expect(mocks.registerPushDevice).not.toHaveBeenCalled()
    })
  })
})
