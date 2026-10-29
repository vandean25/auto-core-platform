import * as React from 'react'
import { toast } from 'sonner'

import { PageLoader } from '@/components/ui/PageLoader'
import type { AuthSession } from '@/api/auth-session'
import type { MeSite } from '@/api/sites'
import { keepPushRegistrationAlive, switchTenantWithPush } from '@/features/push/push-device'
import { usePushDeepLink, type PushTenantSwitchResult } from '@/features/push/use-push-deep-link'
import { purgeAllCheckInOfflineData } from '@/features/workshop/check-in/check-in-offline-store'
import {
  hasUnsyncedCheckInOfflineData,
  summarizeCheckInOfflineUnsynced,
  type CheckInOfflineUnsyncedSummary,
} from '@/features/workshop/check-in/check-in-offline-unsynced'
import { shellPushLinkSiteRefusedMessage, shellSwitchTenantFailedMessage } from '@/lib/shell-session-toasts'

type SwitchTenantPrompt = { kind: 'switchTenant'; tenantId: string; summary: CheckInOfflineUnsyncedSummary }
type SignOutPrompt = { kind: 'signOut'; summary: CheckInOfflineUnsyncedSummary }

/**
 * The shell's authorized tenant switch. `completeTenantSwitch` switches (and moves this browser's push registration to
 * the new tenant, ADR-0033) and then clears the offline check-in data of the tenant being left. `requestTenantSwitch`
 * asks first when check-in data is unsynced (the prompt then completes the switch) and otherwise switches now. It
 * reports which happened, so a push link can wait for the prompt or give up.
 */
export function useTenantSwitch(
  switchTenant: (tenantId: string) => Promise<unknown>,
  askAboutUnsyncedData: (prompt: SwitchTenantPrompt) => void,
) {
  const completeTenantSwitch = React.useCallback(
    async (tenantId: string) => {
      await switchTenantWithPush(() => switchTenant(tenantId))
      await purgeAllCheckInOfflineData().catch(() => undefined)
    },
    [switchTenant],
  )

  const requestTenantSwitch = React.useCallback(
    async (tenantId: string): Promise<PushTenantSwitchResult> => {
      const summary = await summarizeCheckInOfflineUnsynced()
      if (hasUnsyncedCheckInOfflineData(summary)) {
        askAboutUnsyncedData({ kind: 'switchTenant', tenantId, summary })
        return 'prompted'
      }
      try {
        await completeTenantSwitch(tenantId)
        return 'switched'
      } catch (error: unknown) {
        toast.error(shellSwitchTenantFailedMessage(error))
        return 'failed'
      }
    },
    [completeTenantSwitch, askAboutUnsyncedData],
  )

  return { completeTenantSwitch, requestTenantSwitch }
}

/** The shell's sign-out: asks first when check-in data is unsynced, otherwise clears it and signs out. */
export function useSignOutRequest(
  signOutUser: () => Promise<void>,
  askAboutUnsyncedData: (prompt: SignOutPrompt) => void,
) {
  return React.useCallback(async () => {
    const summary = await summarizeCheckInOfflineUnsynced()
    if (hasUnsyncedCheckInOfflineData(summary)) {
      askAboutUnsyncedData({ kind: 'signOut', summary })
      return
    }
    await purgeAllCheckInOfflineData().catch(() => undefined)
    await signOutUser()
  }, [signOutUser, askAboutUnsyncedData])
}

/**
 * Web push in the shell (ADR-0033): renews this browser's registration once a session exists, and opens an order link
 * from a push in the tenant and site it names. `resolving` is true while the app still has to switch.
 */
export function useShellPush(params: {
  session: AuthSession | undefined
  sites: MeSite[] | undefined
  /** True while the list of sites is being fetched; a push link waits instead of judging an outdated list. */
  sitesLoading: boolean
  requestTenantSwitch: (tenantId: string) => Promise<PushTenantSwitchResult>
  switchSite: (siteId: string) => Promise<unknown>
}) {
  const { session, sites, sitesLoading } = params
  const hasSession = Boolean(session)
  React.useEffect(() => {
    if (hasSession) void keepPushRegistrationAlive()
  }, [hasSession])

  return usePushDeepLink({
    enabled: hasSession,
    activeTenantId: session?.activeTenant.id ?? '',
    activeSiteId: session?.activeSiteId ?? null,
    siteIds: sitesLoading ? null : (sites ?? []).map((site) => site.id),
    requestTenantSwitch: params.requestTenantSwitch,
    switchSite: params.switchSite,
    onRefused: () => toast.error(shellPushLinkSiteRefusedMessage()),
  })
}

/** Shows a loader instead of the page while a push link is still switching to the tenant and site it names. */
export function PushLinkGate({ resolving, children }: { resolving: boolean; children: React.ReactNode }) {
  return resolving ? <PageLoader /> : children
}
