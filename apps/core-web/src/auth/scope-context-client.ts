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

type ScopeContextClientState = {
  context: ValidatedScopeContext | null
  quarantined: boolean
  /** User must tap "Liste aktualisieren" after external-scope or a failed handshake. */
  explicitRefreshRequired: boolean
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
  protectedGeneration: 0,
  episodeCounter: 0,
  continuityDigest: null,
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
    protectedGeneration: 0,
    episodeCounter: 0,
    continuityDigest: null,
  })
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
  if (!store.getState().quarantined) return
  store.setState({ quarantined: false, explicitRefreshRequired: false })
}

/**
 * Handshake before an explicit list refresh while quarantined. Returns false when the handshake fails so
 * refresh does not lift quarantine or repopulate rows.
 */
export async function handshakeBeforeExplicitListRefresh(): Promise<boolean> {
  if (!store.getState().quarantined) return true
  const result = await handshakeScopeContext({ force: true })
  if (result.kind === 'failed') return false
  if (result.kind === 'external-scope') {
    acceptQuarantinedScopeForExplicitRefresh()
    return true
  }
  store.setState({ explicitRefreshRequired: false })
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

function classifyHandshake(
  previous: ValidatedScopeContext | null,
  next: ValidatedScopeContext,
  previousContinuity: string | null,
  nextContinuity: string,
): HandshakeResult {
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
    const previous = store.getState().context
    const previousContinuity = store.getState().continuityDigest
    let body: components['schemas']['ScopeContextHandshakeResponseDto']
    try {
      body = await postHandshake()
    } catch {
      applyHandshakeState(epochAtStart, { quarantined: true, explicitRefreshRequired: true })
      return { kind: 'failed' }
    }

    if (epochAtStart !== handshakeEpoch) return { kind: 'failed' }

    const next = readHandshakeBody(body)
    const continuity = body.continuityDigest ?? next.scopeContextDigest
    const outcome = classifyHandshake(previous, next, previousContinuity, continuity)

    if (outcome.kind === 'session') {
      if (
        applyHandshakeState(epochAtStart, {
          continuityDigest: continuity,
          context: next,
          quarantined: false,
          explicitRefreshRequired: false,
        })
      ) {
        bumpCursorEpisodeCounter()
      }
      return outcome
    }

    if (outcome.kind === 'external-scope') {
      applyHandshakeState(epochAtStart, {
        continuityDigest: continuity,
        context: next,
        quarantined: true,
        explicitRefreshRequired: true,
        protectedGeneration: store.getState().protectedGeneration + 1,
      })
      return outcome
    }

    applyHandshakeState(epochAtStart, {
      continuityDigest: continuity,
      context: next,
      quarantined: false,
      explicitRefreshRequired: false,
    })
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
  store.setState({ context: null, continuityDigest: null })
  bumpCursorEpisodeCounter()
}

export function applyUserSessionLifecycle() {
  invalidateProtectedScopeContext()
  bumpCursorEpisodeCounter()
  broadcastSessionLineageToOtherTabs()
}

export { SCOPE_CONTEXT_HEADER }
