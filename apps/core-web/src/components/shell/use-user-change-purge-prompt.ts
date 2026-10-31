import * as React from 'react'
import { purgeAllCheckInOfflineData } from '@/features/workshop/check-in/check-in-offline-store'
import {
  hasUnsyncedCheckInOfflineData,
  summarizeCheckInOfflineUnsynced,
  type CheckInOfflineUnsyncedSummary,
} from '@/features/workshop/check-in/check-in-offline-unsynced'

export type UserChangeOfflinePurge = {
  summary: CheckInOfflineUnsyncedSummary | null
  dismiss: () => void
  discard: () => Promise<void>
}

/**
 * Asks before unsynced check-ins of the previous user stay on a shared device (AUT-819). A sign-out and a tenant
 * switch ask through `ShellPurgePrompt`; this covers the remaining case of another user taking over the tab (uid A
 * to B without an explicit sign-out). Nothing is deleted until the prompt is confirmed.
 */
export function useUserChangeOfflinePurge(currentUserId: string | null): UserChangeOfflinePurge {
  const previousUserIdRef = React.useRef<string | null | undefined>(undefined)
  const [summary, setSummary] = React.useState<CheckInOfflineUnsyncedSummary | null>(null)

  React.useEffect(() => {
    const previousUserId = previousUserIdRef.current
    previousUserIdRef.current = currentUserId

    if (!previousUserId || !currentUserId || previousUserId === currentUserId) {
      return
    }

    let cancelled = false
    void summarizeCheckInOfflineUnsynced().then((nextSummary) => {
      if (cancelled || !hasUnsyncedCheckInOfflineData(nextSummary)) return
      setSummary(nextSummary)
    })

    return () => {
      cancelled = true
    }
  }, [currentUserId])

  const dismiss = React.useCallback(() => {
    setSummary(null)
  }, [])

  const discard = React.useCallback(async () => {
    await purgeAllCheckInOfflineData().catch(() => undefined)
    setSummary(null)
  }, [])

  return { summary, dismiss, discard }
}
