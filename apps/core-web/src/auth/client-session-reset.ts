import * as React from 'react'
import { getCurrentScope, setUser } from '@sentry/react'
import type { QueryClient } from '@tanstack/react-query'
import { clearPersistedQueryCache } from '@/auth/persisted-query-cache'

/**
 * AUT-819: one reset for every client-side trace of a user or tenant session. Called on sign-out, on a Firebase uid
 * change and on a tenant switch; the site switch uses the same reset because every cached query may belong to the old
 * site. Server-side authorization is unaffected.
 */

/** User-scoped keys whose suffix is a user id, tenant id or both. */
const USER_LOCAL_STORAGE_PREFIXES = [
  'acp:dashboard-widgets:',
  'acp:saved-views:',
  'acp:onboarding-checklist:dismissed:',
  'acp:global-search:recent:',
] as const

/** Keys that belong to the current user's session on this browser. */
const USER_LOCAL_STORAGE_KEYS = [
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

/** Brings the session generation forward, remounting every provider that holds user or tenant data. */
function startNewClientSession(): void {
  generation += 1
  clearSentryUser()
  emit()
}

/**
 * Cancels running queries first so a late response cannot repopulate the cache after it was cleared, then drops every
 * query and mutation, the user/tenant scoped storage and the in-memory session state. Device preferences (language,
 * sidebar, view modes, deviceId, e2e overrides) are left untouched.
 */
export async function resetClientSession(queryClient: QueryClient): Promise<void> {
  await runWithClientSessionPending(async () => {
    await queryClient.cancelQueries()
    queryClient.clear()

    removeSessionStorageKeys(
      window.localStorage,
      USER_LOCAL_STORAGE_PREFIXES,
      USER_LOCAL_STORAGE_KEYS,
    )
    removeSessionStorageKeys(window.sessionStorage, TENANT_SESSION_STORAGE_PREFIXES, [])

    clearPersistedQueryCache()
    startNewClientSession()
  })
}
