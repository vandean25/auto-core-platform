import * as React from 'react'
import { getCurrentScope, setUser } from '@sentry/react'
import type { QueryClient } from '@tanstack/react-query'
import { clearPersistedQueryCache } from '@/auth/persisted-query-cache'

/**
 * AUT-819: one reset for every client-side trace of a user or tenant session. Server-side authorization is
 * unaffected.
 *
 * Two levels:
 * - `session`: sign-out and user change. Drops the cache, the tenant session storage and the previous user's
 *   session keys (push registration, e-mail link, mechanic id).
 * - `context`: tenant or site switch by the same user. Drops the cache and the tenant session storage only, so
 *   saved views, the dashboard layout, onboarding state and the push registration survive the switch.
 *
 * Saved views (`acp:saved-views:<userId>`) and the dashboard layout (`acp:dashboard-widgets:<userId>`) are keyed by
 * user id and are never removed here: the product decision for AUT-819 keeps them across sign-out, and the
 * providers only ever read the key of the signed-in user.
 */

export type ClientSessionResetScope = 'session' | 'context'

/** Keys that belong to the signed-in user and must not reach the next user of this browser. */
const SESSION_LOCAL_STORAGE_PREFIXES = [
  'acp:onboarding-checklist:dismissed:',
  'acp:global-search:recent:',
] as const

const SESSION_LOCAL_STORAGE_KEYS = [
  'acp.push.registration',
  'acp.push.keep-alive',
  'emailForSignIn',
  'acp:mechanic-id',
] as const

/** Brand-extraction ids are stored per legal entity of the active tenant. */
const TENANT_SESSION_STORAGE_PREFIXES = ['acp.document-brand-extraction.'] as const

type Listener = () => void

const listeners = new Set<Listener>()
let generation = 0
let pendingResets = 0

function emit(): void {
  for (const listener of listeners) listener()
}

function subscribe(listener: Listener): () => void {
  listeners.add(listener)
  return () => {
    listeners.delete(listener)
  }
}

export function getClientSessionGeneration(): number {
  return generation
}

export function isClientSessionResetting(): boolean {
  return pendingResets > 0
}

export function useClientSessionGeneration(): number {
  return React.useSyncExternalStore(
    subscribe,
    getClientSessionGeneration,
    getClientSessionGeneration,
  )
}

export function useClientSessionResetting(): boolean {
  return React.useSyncExternalStore(
    subscribe,
    isClientSessionResetting,
    isClientSessionResetting,
  )
}

/**
 * Marks the client session as switching for as long as `work` runs, so the shell shows a loading state instead of
 * the previous user's, tenant's or site's data. Nested calls keep the state up until the outermost one settles.
 */
export function runWithClientSessionPending<T>(work: () => Promise<T>): Promise<T> {
  pendingResets += 1
  emit()

  const settle = () => {
    pendingResets -= 1
    emit()
  }

  let result: Promise<T>
  try {
    result = work()
  } catch (error) {
    settle()
    return Promise.reject(error)
  }

  return result.finally(settle)
}

function removeSessionStorageKeys(
  storage: Storage,
  prefixes: readonly string[],
  keys: readonly string[],
): void {
  try {
    const matchingKeys: string[] = []
    for (let index = 0; index < storage.length; index += 1) {
      const key = storage.key(index)
      if (!key) continue
      if (keys.includes(key) || prefixes.some((prefix) => key.startsWith(prefix))) {
        matchingKeys.push(key)
      }
    }
    for (const key of matchingKeys) storage.removeItem(key)
  } catch {
    // Blocked storage cannot hold a session either; nothing to remove then.
  }
}

function clearSentryUser(): void {
  try {
    if (!getCurrentScope().getUser()) return
    setUser(null)
  } catch {
    // Sentry is optional (and not initialized in every environment).
  }
}

/** Brings the session generation forward, remounting every provider that holds user, tenant or site data. */
function bumpClientSessionGeneration(): void {
  generation += 1
  emit()
}

/**
 * Cancels running queries first so a late response cannot repopulate the cache after it was cleared, then drops every
 * query and mutation and the tenant scoped session storage. A `session` reset also removes the previous user's
 * session keys and the Sentry user; a `context` reset keeps them for the same user's next tenant or site.
 * Device preferences (language, sidebar, view modes, deviceId, e2e overrides) are left untouched by both.
 */
export async function resetClientSession(
  queryClient: QueryClient,
  scope: ClientSessionResetScope = 'session',
): Promise<void> {
  await runWithClientSessionPending(async () => {
    await queryClient.cancelQueries()
    queryClient.clear()

    removeSessionStorageKeys(window.sessionStorage, TENANT_SESSION_STORAGE_PREFIXES, [])

    if (scope === 'session') {
      removeSessionStorageKeys(
        window.localStorage,
        SESSION_LOCAL_STORAGE_PREFIXES,
        SESSION_LOCAL_STORAGE_KEYS,
      )
      clearSentryUser()
    }

    clearPersistedQueryCache()
    bumpClientSessionGeneration()
  })
}
