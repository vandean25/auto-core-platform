import type { QueryKey } from '@tanstack/react-query'

import { fetchWithAuth } from '@/api/client'
import type { components } from '@/api/generated/openapi'
import {
  SCOPE_CONTEXT_HANDSHAKE_PATH,
  SCOPE_CONTEXT_HEADER,
  SCOPE_CONTEXT_LOGOUT_PATH,
  SCOPE_CONTEXT_SESSION_LINEAGE_STORAGE_KEY,
} from '@/auth/scope-context.constants'

export type ValidatedScopeContext = {
  scopeContext: string
  scopeContextDigest: string
}

type Listener = () => void

type HandshakeResult =
  | { kind: 'same'; context: ValidatedScopeContext }
  | { kind: 'external-scope'; context: ValidatedScopeContext; previousDigest: string }
  | { kind: 'session'; context: ValidatedScopeContext }
  | { kind: 'failed' }
  | { kind: 'superseded' }

type ScopeContextClientState = {
  context: ValidatedScopeContext | null
  quarantined: boolean
  /** User must tap "Liste aktualisieren" after external-scope or a failed handshake. */
  explicitRefreshRequired: boolean
  /** Stays set after external-scope until explicit refresh; lifecycle `same` must not lift quarantine. */
  pendingExternalScopeAck: boolean
  protectedGeneration: number
  episodeCounter: number
  continuityDigest: string | null
}

function createStore(initial: ScopeContextClientState) {
  let state = initial
  const listeners = new Set<Listener>()

  return {
    getState: () => state,
    setState(partial: Partial<ScopeContextClientState>) {
      state = { ...state, ...partial }
      listeners.forEach((listener) => listener())
    },
    subscribe(listener: Listener) {
      listeners.add(listener)
      return () => listeners.delete(listener)
    },
  }
}

const store = createStore({
  context: null,
  quarantined: true,
  explicitRefreshRequired: false,
  pendingExternalScopeAck: false,
  protectedGeneration: 0,
  episodeCounter: 0,
  continuityDigest: null,
})

/** Every digest this client has held; only a key ending in one of these is a scope-scoped cursor-list key. */
const issuedScopeDigests = new Set<string>()
store.subscribe(() => {
  const digest = store.getState().context?.scopeContextDigest
  if (digest) issuedScopeDigests.add(digest)
})

let handshakeInFlight: Promise<HandshakeResult> | null = null
let handshakeEpoch = 0

function bumpHandshakeEpoch(): number {
  handshakeEpoch += 1
  return handshakeEpoch
}

function applyHandshakeState(epochAtStart: number, partial: Partial<ScopeContextClientState>): boolean {
  if (epochAtStart !== handshakeEpoch) return false
  store.setState(partial)
  return true
}

function readHandshakeBody(body: components['schemas']['ScopeContextHandshakeResponseDto']): ValidatedScopeContext {
  return { scopeContext: body.scopeContext, scopeContextDigest: body.scopeContextDigest }
}

/** For tests and the provider: installs a fixed SC without calling the API. */
export function seedValidatedScopeContextForTests(context: ValidatedScopeContext, continuityDigest = context.scopeContextDigest) {
  store.setState({
    context,
    quarantined: false,
    explicitRefreshRequired: false,
    pendingExternalScopeAck: false,
    continuityDigest,
  })
}

export function resetScopeContextClientForTests() {
  handshakeInFlight = null
  handshakeEpoch = 0
  store.setState({
    context: null,
    quarantined: true,
    explicitRefreshRequired: false,
    pendingExternalScopeAck: false,
    protectedGeneration: 0,
    episodeCounter: 0,
    continuityDigest: null,
  })
  issuedScopeDigests.clear()
}

export function subscribeScopeContextClient(listener: Listener) {
  return store.subscribe(listener)
}

function getValidatedScopeContext(): ValidatedScopeContext | null {
  return store.getState().context
}

export function getScopeContextDigest(): string | undefined {
  return getValidatedScopeContext()?.scopeContextDigest
}

/**
 * Rebinds a scope-scoped cursor-list key (`[...base, digest]`) to the digest from the latest successful handshake.
 * Any other list key is returned unchanged.
 */
export function listQueryKeyForCurrentDigest(queryKey: QueryKey, digest = getScopeContextDigest()): QueryKey {
  const last = queryKey.at(-1)
  if (!digest || typeof last !== 'string' || !issuedScopeDigests.has(last)) return queryKey
  return [...queryKey.slice(0, -1), digest] as QueryKey
}

export function getProtectedGeneration(): number {
  return store.getState().protectedGeneration
}

export function getCursorEpisodeCounter(): number {
  return store.getState().episodeCounter
}

export function isScopeContextQuarantined(): boolean {
  return store.getState().quarantined
}

export function isScopeExplicitRefreshRequired(): boolean {
  return store.getState().explicitRefreshRequired
}

export function scopeContextReadyForCursorList(): boolean {
  return store.getState().context !== null
}

/** Bumps late-result fencing generation without disabling active queries. */
export function bumpProtectedScopeGeneration() {
  const { protectedGeneration } = store.getState()
  store.setState({ protectedGeneration: protectedGeneration + 1 })
}

/** Lifecycle resync: quarantine protected data until the next successful handshake. */
export function invalidateProtectedScopeContext() {
  bumpProtectedScopeGeneration()
  store.setState({ quarantined: true })
}

export function bumpCursorEpisodeCounter() {
  store.setState({ episodeCounter: store.getState().episodeCounter + 1 })
}

export function scopeContextHeaderValue(): string | undefined {
  return getValidatedScopeContext()?.scopeContext
}

export function shouldDiscardScopeEcho(echoedDigest: string | undefined, observedGeneration: number): boolean {
  if (observedGeneration !== store.getState().protectedGeneration) return true
  if (echoedDigest === undefined) return false
  const validated = store.getState().context?.scopeContextDigest
  if (validated === undefined) return true
  return echoedDigest !== validated
}

/** User tapped "Liste aktualisieren" while quarantined after an external-scope handshake. */
export function acceptQuarantinedScopeForExplicitRefresh(): void {
  store.setState({
    quarantined: false,
    explicitRefreshRequired: false,
    pendingExternalScopeAck: false,
  })
}

/**
 * Handshake before an explicit list refresh while quarantined. Returns false when the handshake fails so
 * refresh does not lift quarantine or repopulate rows.
 */
export async function handshakeBeforeExplicitListRefresh(): Promise<boolean> {
  if (!store.getState().quarantined) return true
  const result = await handshakeScopeContext({ force: true })
  if (result.kind === 'failed') return false
  acceptQuarantinedScopeForExplicitRefresh()
  return true
}

function broadcastSessionLineageToOtherTabs(): void {
  if (typeof window === 'undefined') return
  try {
    window.localStorage.setItem(SCOPE_CONTEXT_SESSION_LINEAGE_STORAGE_KEY, String(Date.now()))
  } catch {
    // Private mode or quota; the local tab already applied lifecycle.
  }
}

async function postHandshake(): Promise<components['schemas']['ScopeContextHandshakeResponseDto']> {
  const response = await fetchWithAuth(SCOPE_CONTEXT_HANDSHAKE_PATH, { method: 'POST' })
  if (!response.ok) {
    throw new Error(`scope-context handshake failed (${response.status})`)
  }
  return response.json() as Promise<components['schemas']['ScopeContextHandshakeResponseDto']>
}

type HandshakeOutcome = Exclude<HandshakeResult, { kind: 'failed' } | { kind: 'superseded' }>

function applyHandshakeOutcome(
  epochAtStart: number,
  outcome: HandshakeOutcome,
  continuityDigest: string,
  quarantinedAtStart: boolean,
) {
  const state = store.getState()
  const base = { continuityDigest, context: outcome.context }

  if (outcome.kind === 'session') {
    const pending = state.pendingExternalScopeAck
    const applied = applyHandshakeState(epochAtStart, {
      ...base,
      quarantined: pending,
      explicitRefreshRequired: pending,
      pendingExternalScopeAck: pending,
    })
    if (applied) bumpCursorEpisodeCounter()
    return
  }

  if (outcome.kind === 'external-scope' || state.pendingExternalScopeAck) {
    applyHandshakeState(epochAtStart, {
      ...base,
      quarantined: true,
      explicitRefreshRequired: true,
      pendingExternalScopeAck: true,
      ...(outcome.kind === 'external-scope' ? { protectedGeneration: state.protectedGeneration + 1 } : {}),
    })
    return
  }

  const lifecycleQuarantine = !quarantinedAtStart && state.quarantined
  applyHandshakeState(epochAtStart, {
    ...base,
    quarantined: lifecycleQuarantine,
    explicitRefreshRequired: lifecycleQuarantine || state.explicitRefreshRequired,
    pendingExternalScopeAck: false,
  })
}

function classifyHandshake(
  previous: ValidatedScopeContext | null,
  next: ValidatedScopeContext,
  previousContinuity: string | null,
  nextContinuity: string,
): HandshakeOutcome {
  if (!previous) return { kind: 'session', context: next }
  if (previousContinuity !== nextContinuity) return { kind: 'session', context: next }
  if (previous.scopeContextDigest !== next.scopeContextDigest) {
    return { kind: 'external-scope', context: next, previousDigest: previous.scopeContextDigest }
  }
  return { kind: 'same', context: next }
}

export async function handshakeScopeContext(options?: { force?: boolean }): Promise<HandshakeResult> {
  if (handshakeInFlight && !options?.force) return handshakeInFlight

  const epochAtStart = bumpHandshakeEpoch()
  const flight = (async (): Promise<HandshakeResult> => {
    const quarantinedAtStart = store.getState().quarantined
    const previous = store.getState().context
    const previousContinuity = store.getState().continuityDigest
    let body: components['schemas']['ScopeContextHandshakeResponseDto']
    try {
      body = await postHandshake()
    } catch {
      applyHandshakeState(epochAtStart, {
        quarantined: true,
        explicitRefreshRequired: true,
        pendingExternalScopeAck: true,
      })
      return { kind: 'failed' }
    }

    if (epochAtStart !== handshakeEpoch) return { kind: 'superseded' }

    const next = readHandshakeBody(body)
    const continuity = body.continuityDigest ?? next.scopeContextDigest
    const outcome = classifyHandshake(previous, next, previousContinuity, continuity)

    applyHandshakeOutcome(epochAtStart, outcome, continuity, quarantinedAtStart)
    return outcome
  })()

  handshakeInFlight = flight
  void flight.finally(() => {
    if (handshakeInFlight === flight) handshakeInFlight = null
  })
  return flight
}

export async function logoutScopeContextLineage(): Promise<void> {
  bumpHandshakeEpoch()
  try {
    await fetchWithAuth(SCOPE_CONTEXT_LOGOUT_PATH, { method: 'POST' })
  } catch {
    // Fail closed on the server when reachable; offline sign-out still clears the client.
  }
  invalidateProtectedScopeContext()
  store.setState({
    context: null,
    continuityDigest: null,
    explicitRefreshRequired: false,
    pendingExternalScopeAck: false,
  })
  bumpCursorEpisodeCounter()
}

export function applyUserSessionLifecycle() {
  store.setState({
    context: null,
    continuityDigest: null,
    explicitRefreshRequired: false,
    pendingExternalScopeAck: false,
  })
  invalidateProtectedScopeContext()
  bumpCursorEpisodeCounter()
  broadcastSessionLineageToOtherTabs()
}

export { SCOPE_CONTEXT_HEADER }
