import { listPushDevices, registerPushDevice, revokePushDevice, type PushDevice } from '@/api/push'
import { firebaseApp, pushVapidKey } from '@/lib/firebase'
import { isServiceWorkerEnabled } from '@/pwa/register-service-worker'

/**
 * Web push for staff on this browser (AUT-766, ADR-0033). The browser permission is only ever requested from
 * `enablePushOnThisDevice`, which the caller runs from a button press. Everything else works with a permission that
 * is already granted, so it never shows a prompt. `firebase/messaging` is loaded on demand.
 */

export type PushSupport = 'ready' | 'off' | 'install-required' | 'unsupported'

const STORAGE_KEY = 'acp.push.registration'
const KEEP_ALIVE_KEY = 'acp.push.keep-alive'
const KEEP_ALIVE_INTERVAL_MS = 24 * 60 * 60 * 1000

export class PushPermissionError extends Error {
  readonly permission: NotificationPermission

  constructor(permission: NotificationPermission) {
    super(`Push permission ${permission}`)
    this.permission = permission
  }
}

function readStorage(key: string): string | null {
  try {
    return window.localStorage.getItem(key)
  } catch {
    return null
  }
}

function writeStorage(key: string, value: string | null): void {
  try {
    if (value === null) window.localStorage.removeItem(key)
    else window.localStorage.setItem(key, value)
  } catch {
    // Private mode or blocked storage: the device then simply is not remembered here.
  }
}

export function isIosDevice(): boolean {
  return /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1)
}

export function isInstalledApp(): boolean {
  return window.matchMedia?.('(display-mode: standalone)').matches === true || (navigator as { standalone?: boolean }).standalone === true
}

export function getPushSupport(): PushSupport {
  if (!pushVapidKey) return 'off'
  // iOS delivers web push to an installed app only, and offers no permission API before that.
  if (isIosDevice() && !isInstalledApp()) return 'install-required'
  const hasApis = 'serviceWorker' in navigator && 'PushManager' in window && 'Notification' in window
  return hasApis && isServiceWorkerEnabled() ? 'ready' : 'unsupported'
}

export function getNotificationPermission(): NotificationPermission | 'unsupported' {
  return 'Notification' in window ? Notification.permission : 'unsupported'
}

export function getStoredDeviceId(): string | null {
  return readStorage(STORAGE_KEY)
}

function detectPlatform(): PushDevice['platform'] {
  if (isIosDevice()) return 'IOS'
  return /Android/.test(navigator.userAgent) ? 'ANDROID' : 'DESKTOP'
}

/** The browser family only, never the full user agent. */
function detectBrowser(): string {
  const agent = navigator.userAgent
  if (/Edg\//.test(agent)) return 'edge'
  if (/Firefox\//.test(agent)) return 'firefox'
  if (/Chrome\/|CriOS\//.test(agent)) return 'chrome'
  if (/Safari\//.test(agent)) return 'safari'
  return 'other'
}

async function loadMessaging() {
  if (!firebaseApp) throw new Error('Firebase is not configured')
  const sdk = await import('firebase/messaging')
  return { sdk, messaging: sdk.getMessaging(firebaseApp) }
}

/** Gets the FCM token for the existing service worker (the one `sw.js` worker handles the push). */
async function obtainToken(): Promise<string> {
  const { sdk, messaging } = await loadMessaging()
  const serviceWorkerRegistration = await navigator.serviceWorker.ready
  return sdk.getToken(messaging, { vapidKey: pushVapidKey, serviceWorkerRegistration })
}

/** Counts the registrations made in this page, so a cleanup that finishes late can tell that a newer token exists. */
let registrationEpoch = 0

async function registerThisBrowser(): Promise<PushDevice> {
  const device = await registerPushDevice({
    token: await obtainToken(),
    platform: detectPlatform(),
    browser: detectBrowser(),
    installed: isInstalledApp(),
  })
  writeStorage(STORAGE_KEY, device.id)
  writeStorage(KEEP_ALIVE_KEY, String(Date.now()))
  registrationEpoch += 1
  return device
}

/** Run from a click handler: this is the only place that asks the browser for the permission. */
export async function enablePushOnThisDevice(): Promise<PushDevice> {
  const permission = await Notification.requestPermission()
  if (permission !== 'granted') throw new PushPermissionError(permission)
  return registerThisBrowser()
}

async function deleteLocalToken(): Promise<void> {
  try {
    const { sdk, messaging } = await loadMessaging()
    await sdk.deleteToken(messaging)
  } catch {
    // No token to delete, or the browser refused: the server side is already revoked.
  }
}

/** The user removes this browser: revoke it on the server, drop the token and forget it. */
export async function disablePushOnThisDevice(): Promise<void> {
  const deviceId = getStoredDeviceId()
  if (deviceId) await revokePushDevice(deviceId)
  writeStorage(STORAGE_KEY, null)
  await deleteLocalToken()
}

const RELEASE_TIMEOUT_MS = 3000

/** Resolves when the work is done or after `ms`, whichever comes first. The work keeps running when time is up. */
function settleWithin(work: Promise<unknown>, ms: number): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, ms)
    void work.finally(() => {
      clearTimeout(timer)
      resolve()
    })
  })
}

/**
 * Before sign-out and before a tenant switch: removes this browser's registration for the tenant being left. The whole
 * cleanup (server call and token deletion) is bounded in time, so a stalled network or push SDK never blocks the
 * sign-out. Returns whether this browser had a registration.
 */
export async function releasePushRegistration(): Promise<boolean> {
  const deviceId = getStoredDeviceId()
  if (!deviceId) return false
  writeStorage(STORAGE_KEY, null)
  const epoch = registrationEpoch
  // Offline or already signed out: the server-side cleanup revokes the device once it is unused.
  const cleanup = revokePushDevice(deviceId)
    .catch(() => undefined)
    .then(deleteLocalToken)
  // A token deletion that only finishes after this browser registered again would delete the new token as well.
  void cleanup.then(() => {
    if (registrationEpoch !== epoch && getStoredDeviceId()) void restorePushRegistration()
  })
  await settleWithin(cleanup, RELEASE_TIMEOUT_MS)
  return true
}

/** After a tenant switch: registers this browser again for the new tenant, without any prompt (permission is granted). */
export async function restorePushRegistration(): Promise<void> {
  if (getPushSupport() !== 'ready' || getNotificationPermission() !== 'granted') return
  try {
    await registerThisBrowser()
  } catch {
    // The user can enable it again in the notification settings.
  }
}

/** Runs a tenant switch and moves this browser's push registration from the old tenant to the new one. */
export async function switchTenantWithPush<T>(switchTenant: () => Promise<T>): Promise<T> {
  const hadRegistration = await releasePushRegistration()
  try {
    const result = await switchTenant()
    if (hadRegistration) await restorePushRegistration()
    return result
  } catch (error) {
    // Still in the old tenant: put the registration back.
    if (hadRegistration) await restorePushRegistration()
    throw error
  }
}

/**
 * Keeps a registered browser fresh: renews it at most once a day (the token may have rotated and the server uses
 * `last_seen_at` to drop devices that are not used). It only renews a registration the server still lists as active.
 * A device that was removed, here or from another browser, is forgotten and never created again: switching push back
 * on needs the enable button. It never prompts.
 */
export async function keepPushRegistrationAlive(): Promise<void> {
  const deviceId = getStoredDeviceId()
  if (!deviceId || getPushSupport() !== 'ready' || getNotificationPermission() !== 'granted') return
  const last = Number(readStorage(KEEP_ALIVE_KEY) ?? 0)
  if (Date.now() - last < KEEP_ALIVE_INTERVAL_MS) return
  try {
    const devices = await listPushDevices()
    if (devices.some((device) => device.id === deviceId)) {
      await registerThisBrowser()
      return
    }
    writeStorage(STORAGE_KEY, null)
    await settleWithin(deleteLocalToken(), RELEASE_TIMEOUT_MS)
  } catch {
    // Offline or refused: retried on the next start, and the registration is left as it is.
  }
}
