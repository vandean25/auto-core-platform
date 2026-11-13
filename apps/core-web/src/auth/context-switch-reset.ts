import type { QueryClient } from '@tanstack/react-query'

import { resetClientSession, runWithClientSessionPending } from '@/auth/client-session-reset'
import { rescopeAfterContextSwitch } from '@/auth/scope-context-client'

/**
 * Tenant or site switch: a `context` reset that keeps the session pending until the scope context of the new tenant or
 * site is in, so no list loads with the previous scope header. `initiatedHere` is false for a switch made in another tab.
 * Its own module: `client-session-reset` is imported by the API client, which the scope client imports in turn.
 */
export function resetClientContextAndRescope(queryClient: QueryClient, initiatedHere: boolean): Promise<void> {
  return runWithClientSessionPending(async () => {
    const rescoped = rescopeAfterContextSwitch(initiatedHere)
    await resetClientSession(queryClient, 'context')
    await rescoped
  })
}
