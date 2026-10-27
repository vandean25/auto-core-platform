/**
 * Registers the offline-safety-net service worker (AUT-740). Only production builds with a release
 * version register it: never the dev server and never the e2e build (its mode is `e2e`).
 */
export function isServiceWorkerEnabled(): boolean {
  return (
    import.meta.env.MODE === 'production' &&
    Boolean(import.meta.env.VITE_APP_VERSION?.trim()) &&
    'serviceWorker' in navigator
  )
}

export function registerServiceWorker(): void {
  if (!isServiceWorkerEnabled()) return

  const register = () => {
    // updateViaCache none: the worker file is always checked against the network (it is served no-cache).
    void navigator.serviceWorker.register('/sw.js', { scope: '/', updateViaCache: 'none' }).catch(() => undefined)
  }

  if (document.readyState === 'complete') register()
  else window.addEventListener('load', register, { once: true })
}

/** Looks for a new worker file now; called from the app version poll so a new release shows up without a hard reload. */
export async function updateServiceWorker(): Promise<void> {
  if (!isServiceWorkerEnabled()) return

  try {
    const registration = await navigator.serviceWorker.getRegistration('/')
    await registration?.update()
  } catch {
    // Offline or blocked: the next poll or focus retries.
  }
}
