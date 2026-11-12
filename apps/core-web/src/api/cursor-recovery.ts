import type { QueryClient, QueryKey } from '@tanstack/react-query'

import { cancelInfiniteList, markInfiniteListStale } from '@/lib/infinite-list-query'
import {
  bumpCursorEpisodeCounter,
  getCursorEpisodeCounter,
  handshakeScopeContext,
} from '@/auth/scope-context-client'
import { isCursorListApiError, type CursorListApiError } from './cursor-list-api-error'

export const CURSOR_NO_RETRY_CODES = new Set([
  'CONTEXT_REQUIRED',
  'CONTEXT_MISMATCH',
  'LIST_CURSOR_INVALID',
  'LIST_CURSOR_SORT_UNSUPPORTED',
  'LIST_CURSOR_STOCK_FILTER_REQUIRED',
  'LIST_CURSOR_PARAM_FORBIDDEN',
  'LIST_PARAMS_UNSUPPORTED',
  'LIST_STATUS_INVALID',
])

const CONTEXT_HANDSHAKE_CODES = new Set(['CONTEXT_REQUIRED', 'CONTEXT_MISMATCH'])

export function cursorQueryShouldRetry(failureCount: number, error: unknown): boolean {
  if (isCursorListApiError(error)) {
    if (error.status === 401 || error.status === 403 || error.status === 422) return false
    if (error.code && CURSOR_NO_RETRY_CODES.has(error.code)) return false
    if (error.status >= 500) return failureCount < 1
    return false
  }
  if (error instanceof TypeError) return failureCount < 1
  return failureCount < 1
}

type EpisodeRecoveryState = {
  budget: 0 | 1
  offsetLatched: boolean
  authBlocked: boolean
  recoveryInFlight: Promise<CursorRecoveryOutcome> | null
}

const episodes = new Map<string, EpisodeRecoveryState>()

function episodeKeyOf(episodeCounter: number, semanticKey: string) {
  return `${episodeCounter}:${semanticKey}`
}

function readEpisodeState(key: string): EpisodeRecoveryState {
  const existing = episodes.get(key)
  if (existing) return existing
  const created: EpisodeRecoveryState = { budget: 1, offsetLatched: false, authBlocked: false, recoveryInFlight: null }
  episodes.set(key, created)
  return created
}

export function resetCursorRecoveryForTests() {
  episodes.clear()
}

export function cursorEpisodeBudgetForTests(semanticKey: string): 0 | 1 {
  return readEpisodeState(episodeKeyOf(getCursorEpisodeCounter(), semanticKey)).budget
}

export function latchUnsupportedSortForEpisode(semanticKey: string) {
  const key = episodeKeyOf(getCursorEpisodeCounter(), semanticKey)
  const state = readEpisodeState(key)
  state.offsetLatched = true
}

export function isOffsetLatchedForEpisode(semanticKey: string): boolean {
  const key = episodeKeyOf(getCursorEpisodeCounter(), semanticKey)
  return readEpisodeState(key).offsetLatched
}

export function isAuthBlockedForEpisode(semanticKey: string): boolean {
  const key = episodeKeyOf(getCursorEpisodeCounter(), semanticKey)
  return readEpisodeState(key).authBlocked
}

export function startNewCursorRecoveryEpisode() {
  bumpCursorEpisodeCounter()
}

async function flushListCache(
  client: QueryClient,
  listKey: QueryKey,
  countKey: QueryKey,
  options?: { cancelInFlight?: boolean },
) {
  client.setQueryData(listKey, () => undefined)
  client.setQueryData(countKey, () => undefined)
  if (options?.cancelInFlight !== false) {
    await cancelInfiniteList(client, listKey)
  }
}

async function blockListEpisode(client: QueryClient, listKey: QueryKey, countKey: QueryKey) {
  await flushListCache(client, listKey, countKey)
  markInfiniteListStale(client, listKey)
  return { type: 'blocked', externalScope: false } as const
}

export type CursorRecoveryOutcome =
  | { type: 'throw'; error: CursorListApiError }
  | { type: 'restart-page-one' }
  | { type: 'offset-latch' }
  | { type: 'blocked'; externalScope: boolean }
  | { type: 'pass-through'; error: CursorListApiError }

export async function resolveCursorListFailure(
  client: QueryClient,
  options: {
    error: CursorListApiError
    semanticKey: string
    listKey: QueryKey
    countKey: QueryKey
    contextValid: boolean
  },
): Promise<CursorRecoveryOutcome> {
  const { error, semanticKey, listKey, countKey, contextValid } = options
  const episode = readEpisodeState(episodeKeyOf(getCursorEpisodeCounter(), semanticKey))

  if (error.code === 'LIST_CURSOR_SORT_UNSUPPORTED') {
    episode.offsetLatched = true
    await flushListCache(client, listKey, countKey, { cancelInFlight: false })
    return { type: 'offset-latch' }
  }

  if (error.code === 'LIST_CURSOR_INVALID' && contextValid) {
    if (episode.budget === 0) {
      return blockListEpisode(client, listKey, countKey)
    }
    episode.budget = 0
    await flushListCache(client, listKey, countKey, { cancelInFlight: false })
    return { type: 'restart-page-one' }
  }

  if (error.code && CONTEXT_HANDSHAKE_CODES.has(error.code)) {
    if (episode.recoveryInFlight) {
      return episode.recoveryInFlight
    }

    episode.recoveryInFlight = (async (): Promise<CursorRecoveryOutcome> => {
      if (episode.budget === 0) {
        return blockListEpisode(client, listKey, countKey)
      }

      episode.budget = 0
      await flushListCache(client, listKey, countKey, { cancelInFlight: false })

      const handshake = await handshakeScopeContext()
      if (handshake.kind === 'external-scope') {
        markInfiniteListStale(client, listKey)
        return { type: 'blocked', externalScope: true }
      }
      if (handshake.kind === 'failed') {
        return { type: 'blocked', externalScope: false }
      }
      if (handshake.kind === 'session') {
        startNewCursorRecoveryEpisode()
        return { type: 'blocked', externalScope: false }
      }

      return { type: 'restart-page-one' }
    })().finally(() => {
      episode.recoveryInFlight = null
    })

    return episode.recoveryInFlight
  }

  if (error.status === 401 || error.status === 403) {
    episode.authBlocked = true
    return blockListEpisode(client, listKey, countKey)
  }

  if (error.status === 422) {
    if (error.code && CURSOR_NO_RETRY_CODES.has(error.code)) {
      return { type: 'pass-through', error }
    }
    episode.authBlocked = true
    return blockListEpisode(client, listKey, countKey)
  }

  return { type: 'pass-through', error }
}

export async function applyExternalScopeBlock(client: QueryClient, listKey: QueryKey, countKey: QueryKey) {
  await flushListCache(client, listKey, countKey)
  markInfiniteListStale(client, listKey)
}
