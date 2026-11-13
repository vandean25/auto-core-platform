import { CancelledError, type QueryClient, type QueryKey } from '@tanstack/react-query'
import { useSyncExternalStore } from 'react'

import { cancelInfiniteList, markInfiniteListStale } from '@/lib/infinite-list-query'
import {
  bumpCursorEpisodeCounter,
  getCursorEpisodeCounter,
  handshakeScopeContext,
  scopeContextReadyForCursorList,
  subscribeScopeContextClient,
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
  if (error instanceof DOMException && error.name === 'AbortError') return false
  if (error instanceof CancelledError) return false
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
  offsetHandoffPending: boolean
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
  const created: EpisodeRecoveryState = {
    budget: 1,
    offsetLatched: false,
    offsetHandoffPending: false,
    authBlocked: false,
    recoveryInFlight: null,
  }
  episodes.set(key, created)
  return created
}

export function resetCursorRecoveryForTests() {
  episodes.clear()
}

export function cursorEpisodeBudgetForTests(semanticKey: string): 0 | 1 {
  return readEpisodeState(episodeKeyOf(getCursorEpisodeCounter(), semanticKey)).budget
}

const handoffListeners = new Set<() => void>()

function publishHandoffChange() {
  handoffListeners.forEach((listener) => listener())
}

function armOffsetHandoff(state: EpisodeRecoveryState) {
  state.offsetLatched = true
  state.offsetHandoffPending = true
  publishHandoffChange()
}

export function latchUnsupportedSortForEpisode(semanticKey: string) {
  armOffsetHandoff(readEpisodeState(episodeKeyOf(getCursorEpisodeCounter(), semanticKey)))
}

function isOffsetHandoffPending(semanticKey: string): boolean {
  const state = episodes.get(episodeKeyOf(getCursorEpisodeCounter(), semanticKey))
  return state?.offsetLatched === true && state.offsetHandoffPending
}

/** Called once the offset list has read page 1 after an unsupported-sort latch; lists then switch to the table page. */
export function completeOffsetLatchHandoff(semanticKey: string) {
  const state = episodes.get(episodeKeyOf(getCursorEpisodeCounter(), semanticKey))
  if (!state?.offsetHandoffPending) return
  state.offsetHandoffPending = false
  publishHandoffChange()
}

function subscribeOffsetHandoff(listener: () => void) {
  handoffListeners.add(listener)
  const stopScope = subscribeScopeContextClient(listener)
  return () => {
    handoffListeners.delete(listener)
    stopScope()
  }
}

/**
 * Offset page of a list after an unsupported-sort latch: page 1 until it has been read once in this episode
 * (`handoffPending`, which callers turn into a fresh read so a cached page 1 cannot skip it), then the table page.
 */
export function useOffsetLatchPage(semanticKey: string, offsetLatched: boolean, tablePage: number) {
  const pending = useSyncExternalStore(subscribeOffsetHandoff, () => isOffsetHandoffPending(semanticKey))
  const handoffPending = offsetLatched && pending
  return { page: handoffPending ? 1 : tablePage, handoffPending }
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

async function recoverViaHandshake(
  client: QueryClient,
  episode: EpisodeRecoveryState,
  listKey: QueryKey,
  countKey: QueryKey,
): Promise<CursorRecoveryOutcome> {
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
  if (handshake.kind === 'superseded') {
    return { type: 'restart-page-one' }
  }
  if (handshake.kind === 'session') {
    startNewCursorRecoveryEpisode()
    return { type: 'blocked', externalScope: false }
  }

  return { type: 'restart-page-one' }
}

async function restartAfterInvalidCursor(
  client: QueryClient,
  episode: EpisodeRecoveryState,
  listKey: QueryKey,
  countKey: QueryKey,
): Promise<CursorRecoveryOutcome> {
  if (episode.budget === 0) {
    return blockListEpisode(client, listKey, countKey)
  }
  episode.budget = 0
  await client.cancelQueries({ queryKey: listKey, exact: true })
  await client.cancelQueries({ queryKey: countKey, exact: true })
  return { type: 'restart-page-one' }
}

function joinHandshakeRecovery(
  client: QueryClient,
  episode: EpisodeRecoveryState,
  listKey: QueryKey,
  countKey: QueryKey,
): Promise<CursorRecoveryOutcome> {
  episode.recoveryInFlight ??= recoverViaHandshake(client, episode, listKey, countKey).finally(() => {
    episode.recoveryInFlight = null
  })
  return episode.recoveryInFlight
}

/** 401/403 always block the episode; 422 blocks unless its code is a known no-retry pass-through. */
function blocksEpisodeForStatus(error: CursorListApiError): boolean {
  if (error.status === 401 || error.status === 403) return true
  if (error.status !== 422) return false
  return !(error.code && CURSOR_NO_RETRY_CODES.has(error.code))
}

export async function resolveCursorListFailure(
  client: QueryClient,
  options: {
    error: CursorListApiError
    semanticKey: string
    listKey: QueryKey
    countKey: QueryKey
  },
): Promise<CursorRecoveryOutcome> {
  const { error, semanticKey, listKey, countKey } = options
  const episode = readEpisodeState(episodeKeyOf(getCursorEpisodeCounter(), semanticKey))

  if (error.code === 'LIST_CURSOR_SORT_UNSUPPORTED') {
    armOffsetHandoff(episode)
    await flushListCache(client, listKey, countKey, { cancelInFlight: false })
    return { type: 'offset-latch' }
  }

  if (error.code === 'LIST_CURSOR_INVALID' && scopeContextReadyForCursorList()) {
    return restartAfterInvalidCursor(client, episode, listKey, countKey)
  }

  if (error.code && CONTEXT_HANDSHAKE_CODES.has(error.code)) {
    return joinHandshakeRecovery(client, episode, listKey, countKey)
  }

  if (blocksEpisodeForStatus(error)) {
    episode.authBlocked = true
    return blockListEpisode(client, listKey, countKey)
  }

  return { type: 'pass-through', error }
}

export async function applyExternalScopeBlock(client: QueryClient, listKey: QueryKey, countKey: QueryKey) {
  await flushListCache(client, listKey, countKey)
  markInfiniteListStale(client, listKey)
}
