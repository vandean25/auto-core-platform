import { useCallback, useEffect, useState } from 'react'
import {
  APP_VERSION_POLL_INTERVAL_MS,
  hasNewAppVersion,
  isAppVersionCheckEnabled,
  normalizeAppVersion,
  type VersionJsonPayload,
} from '@/lib/app-version'

const bundledAppVersion = normalizeAppVersion(import.meta.env.VITE_APP_VERSION)

export function useAppVersionUpdate() {
  const [updateAvailable, setUpdateAvailable] = useState(false)

  const checkForUpdate = useCallback(async () => {
    if (!isAppVersionCheckEnabled(bundledAppVersion)) {
      return
    }

    try {
      const response = await fetch(`/version.json?_=${Date.now()}`, { cache: 'no-store' })
      if (!response.ok) {
        return
      }
      const payload = (await response.json()) as VersionJsonPayload
      setUpdateAvailable(hasNewAppVersion(bundledAppVersion, payload.version))
    } catch {
      // Ignore transient network errors; next poll or focus will retry.
    }
  }, [])

  useEffect(() => {
    if (!isAppVersionCheckEnabled(bundledAppVersion)) {
      return
    }

    void checkForUpdate()

    const intervalId = window.setInterval(() => {
      void checkForUpdate()
    }, APP_VERSION_POLL_INTERVAL_MS)

    const onFocus = () => {
      void checkForUpdate()
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === 'visible') {
        void checkForUpdate()
      }
    }

    window.addEventListener('focus', onFocus)
    document.addEventListener('visibilitychange', onVisibilityChange)

    return () => {
      window.clearInterval(intervalId)
      window.removeEventListener('focus', onFocus)
      document.removeEventListener('visibilitychange', onVisibilityChange)
    }
  }, [checkForUpdate])

  const reload = useCallback(() => {
    window.location.reload()
  }, [])

  return { updateAvailable, reload }
}
