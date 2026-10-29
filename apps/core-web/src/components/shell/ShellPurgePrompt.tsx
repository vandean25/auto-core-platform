import { toast } from 'sonner'

import { CheckInOfflinePurgeDialog } from '@/features/workshop/check-in/CheckInOfflinePurgeDialog'
import { purgeAllCheckInOfflineData } from '@/features/workshop/check-in/check-in-offline-store'
import type { CheckInOfflineUnsyncedSummary } from '@/features/workshop/check-in/check-in-offline-unsynced'
import { shellSwitchTenantFailedMessage } from '@/lib/shell-session-toasts'

export type CheckInOfflinePurgePrompt =
  | { kind: 'signOut'; summary: CheckInOfflineUnsyncedSummary }
  | { kind: 'switchTenant'; tenantId: string; summary: CheckInOfflineUnsyncedSummary }

type Props = {
  prompt: CheckInOfflinePurgePrompt
  onClose: () => void
  /** Called when the user declines; a push link waiting for a tenant switch gives up then. */
  onCancel: () => void
  /** Called when a confirmed tenant switch fails; a push link waiting for it gives up then. */
  onSwitchFailed: () => void
  completeTenantSwitch: (tenantId: string) => Promise<void>
  signOutUser: () => Promise<void>
}

/** Asks whether unsynced check-in data may be discarded before a tenant switch or a sign-out, then does it. */
export function ShellPurgePrompt({ prompt, onClose, onCancel, onSwitchFailed, completeTenantSwitch, signOutUser }: Props) {
  const confirm = async () => {
    if (prompt.kind === 'switchTenant') {
      try {
        await completeTenantSwitch(prompt.tenantId)
      } catch (error: unknown) {
        toast.error(shellSwitchTenantFailedMessage(error))
        onSwitchFailed()
      }
      return
    }
    await purgeAllCheckInOfflineData().catch(() => undefined)
    await signOutUser()
  }

  return (
    <CheckInOfflinePurgeDialog
      open
      summary={prompt.summary}
      onCancel={() => {
        onClose()
        onCancel()
      }}
      onConfirm={() => {
        onClose()
        void confirm()
      }}
    />
  )
}
