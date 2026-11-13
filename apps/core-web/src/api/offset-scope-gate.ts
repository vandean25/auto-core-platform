import { useQueryClient, type QueryKey } from '@tanstack/react-query'

import {
  getProtectedGeneration,
  getScopeContextDigest,
  handshakeBeforeExplicitListRefresh,
} from '@/auth/scope-context-client'
import {
  useScopeContextDigest,
  useScopeContextQuarantined,
  useScopeContextReady,
  useScopeExplicitRefreshRequired,
} from '@/auth/use-scope-context-digest'
import { StaleScopeResponseError } from './cursor-list-api-error'

/**
 * Scope rules of an offset fallback list (non-cursor sort or filter, unsupported-sort latch, unpaged invoices), the
 * same as the cursor list's: it loads only with a validated scope, keys its cache by the scope digest, hides its rows
 * while the scope client holds lists, and offers "Liste aktualisieren" (handshake first, then a reload of
 * `listFamilyKey`) while an explicit refresh is due.
 */
export function useOffsetScopeGate(listFamilyKey: QueryKey) {
  const queryClient = useQueryClient()
  const digest = useScopeContextDigest()
  const ready = useScopeContextReady()
  const quarantined = useScopeContextQuarantined()
  const explicitRefreshRequired = useScopeExplicitRefreshRequired()
  const refresh = async () => {
    if (!(await handshakeBeforeExplicitListRefresh())) return
    await queryClient.invalidateQueries({ queryKey: listFamilyKey })
  }
  return {
    digest,
    enabled: ready && !quarantined,
    hidden: quarantined,
    waiting: !ready || quarantined,
    onScopeRefresh: explicitRefreshRequired ? refresh : undefined,
  }
}

export type OffsetScopeGate = ReturnType<typeof useOffsetScopeGate>

/** The scope digest at the end of an offset list key, so another scope never reuses this cache entry. */
export function scopedOffsetKey<TKey extends QueryKey>(key: TKey, scopeDigest: string | undefined): QueryKey {
  return scopeDigest === undefined ? key : [...key, scopeDigest]
}

/**
 * Reads an offset page for `scopeDigest`. Offset responses carry no digest echo, so the client checks the scope itself:
 * not sent when the key's digest is no longer current, dropped when a handshake changed the generation or the scope
 * while the request ran.
 */
export async function readScopedOffset<T>(scopeDigest: string | undefined, read: () => Promise<T>): Promise<T> {
  if (scopeDigest === undefined) return read()
  if (getScopeContextDigest() !== scopeDigest) throw new StaleScopeResponseError(false)
  const generation = getProtectedGeneration()
  const result = await read()
  if (generation !== getProtectedGeneration() || getScopeContextDigest() !== scopeDigest) {
    throw new StaleScopeResponseError(true)
  }
  return result
}

type OffsetQueryState = { isLoading: boolean; isError: boolean; refetch: () => Promise<unknown> }

/** DataTable props of an offset fallback list under its scope gate. */
export function scopedOffsetTableProps(query: OffsetQueryState, scope: OffsetScopeGate, pageCount: number) {
  return {
    pageCount,
    isLoading: query.isLoading || scope.waiting,
    isError: query.isError && !scope.hidden,
    onRetry: scope.hidden ? undefined : () => void query.refetch(),
    onScopeRefresh: scope.onScopeRefresh,
  }
}
