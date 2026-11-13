import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import {
  applyUserSessionLifecycle,
  getScopeContextDigest,
  handshakeBeforeExplicitListRefresh,
  handshakeScopeContext,
  invalidateProtectedScopeContext,
  isScopeContextQuarantined,
  isScopeExplicitRefreshRequired,
  listQueryKeyForCurrentDigest,
  logoutScopeContextLineage,
  resetScopeContextClientForTests,
  seedValidatedScopeContextForTests,
} from './scope-context-client'

vi.mock('@/api/client', () => ({ fetchWithAuth: vi.fn() }))

describe('scope-context-client handshake epoch', () => {
  beforeEach(() => {
    resetScopeContextClientForTests()
    seedValidatedScopeContextForTests({ scopeContext: 'sc-old', scopeContextDigest: 'digest-old' })
  })

  afterEach(() => vi.clearAllMocks())

  it('drops a late handshake response after logout', async () => {
    let resolveHandshake: (value: Response) => void
    const handshakePromise = new Promise<Response>((resolve) => {
      resolveHandshake = resolve
    })

    let logoutPosts = 0
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      if (String(url).includes('/api/auth/scope-context')) return handshakePromise
      if (String(url).includes('/api/auth/logout')) {
        logoutPosts += 1
        return { ok: true, json: async () => ({}) } as Response
      }
      throw new Error(`unexpected ${url}`)
    })

    const inFlight = handshakeScopeContext({ force: true })
    await logoutScopeContextLineage()

    expect(logoutPosts).toBe(1)
    expect(getScopeContextDigest()).toBeUndefined()

    resolveHandshake!({
      ok: true,
      json: async () => ({
        scopeContext: 'sc-stale',
        scopeContextDigest: 'digest-stale',
        continuityDigest: 'lineage-1',
      }),
    } as Response)

    await inFlight
    expect(getScopeContextDigest()).toBeUndefined()
  })

  // Regression: the session wipe on a uid change did not bump the epoch, so the in-flight body restored the old scope.
  it('drops a handshake that was in flight when the signed-in user changed', async () => {
    let resolveHandshake: (value: Response) => void
    const handshakePromise = new Promise<Response>((resolve) => {
      resolveHandshake = resolve
    })
    vi.mocked(fetchWithAuth).mockImplementation(async () => handshakePromise)

    const inFlight = handshakeScopeContext({ force: true })
    applyUserSessionLifecycle()
    resolveHandshake!({
      ok: true,
      json: async () => ({ scopeContext: 'sc-stale', scopeContextDigest: 'digest-stale', continuityDigest: 'lineage-1' }),
    } as Response)

    await inFlight
    expect(getScopeContextDigest()).toBeUndefined()
  })

  // Regression: a handshake started by focus/online during the logout POST was applied after the clear.
  it('drops a handshake that started while the logout POST was pending', async () => {
    let resolveHandshake: (value: Response) => void
    const handshakePromise = new Promise<Response>((resolve) => {
      resolveHandshake = resolve
    })
    let resolveLogout: (value: Response) => void
    const logoutPromise = new Promise<Response>((resolve) => {
      resolveLogout = resolve
    })
    vi.mocked(fetchWithAuth).mockImplementation(async (url) =>
      String(url).includes('/api/auth/scope-context') ? handshakePromise : logoutPromise,
    )

    const loggingOut = logoutScopeContextLineage()
    const inFlight = handshakeScopeContext({ force: true })
    resolveLogout!({ ok: true, json: async () => ({}) } as Response)
    await loggingOut
    resolveHandshake!({
      ok: true,
      json: async () => ({ scopeContext: 'sc-stale', scopeContextDigest: 'digest-stale', continuityDigest: 'lineage-1' }),
    } as Response)

    await inFlight
    expect(getScopeContextDigest()).toBeUndefined()
  })

  it('drops a late handshake when a newer handshake supersedes it', async () => {
    const order: string[] = []
    let call = 0
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      if (!String(url).includes('/api/auth/scope-context')) {
        throw new Error(`unexpected ${url}`)
      }
      call += 1
      if (call === 1) {
        await new Promise((resolve) => setTimeout(resolve, 30))
        order.push('first')
        return {
          ok: true,
          json: async () => ({
            scopeContext: 'sc-stale',
            scopeContextDigest: 'digest-stale',
            continuityDigest: 'lineage-1',
          }),
        } as Response
      }
      order.push('second')
      return {
        ok: true,
        json: async () => ({
          scopeContext: 'sc-new',
          scopeContextDigest: 'digest-new',
          continuityDigest: 'lineage-1',
        }),
      } as Response
    })

    const first = handshakeScopeContext({ force: true })
    const second = handshakeScopeContext({ force: true })
    await Promise.all([first, second])

    expect(order).toEqual(['second', 'first'])
    expect(getScopeContextDigest()).toBe('digest-new')
  })

  // Regression: a superseded explicit-refresh handshake lifted quarantine although the newer handshake had failed.
  it('keeps the failed-handshake latch when an older explicit refresh handshake is superseded', async () => {
    invalidateProtectedScopeContext()
    let call = 0
    vi.mocked(fetchWithAuth).mockImplementation(async () => {
      call += 1
      if (call === 1) {
        await new Promise((resolve) => setTimeout(resolve, 30))
        return {
          ok: true,
          json: async () => ({ scopeContext: 'sc-old', scopeContextDigest: 'digest-old', continuityDigest: 'digest-old' }),
        } as Response
      }
      return { ok: false, status: 503, json: async () => ({}) } as Response
    })

    const older = handshakeBeforeExplicitListRefresh()
    const newer = handshakeBeforeExplicitListRefresh()

    expect(await newer).toBe(false)
    expect(await older).toBe(false)
    expect(isScopeContextQuarantined()).toBe(true)
    expect(isScopeExplicitRefreshRequired()).toBe(true)
  })

  it('POSTs again when a new handshake is requested after the previous flight settled', async () => {
    let posts = 0
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      if (!String(url).includes('/api/auth/scope-context')) {
        throw new Error(`unexpected ${url}`)
      }
      posts += 1
      const digest = posts === 1 ? 'digest-old' : 'digest-new'
      return {
        ok: true,
        json: async () => ({
          scopeContext: `sc-${posts}`,
          scopeContextDigest: digest,
          continuityDigest: 'lineage-1',
        }),
      } as Response
    })

    await handshakeScopeContext({ force: true })
    expect(posts).toBe(1)
    expect(getScopeContextDigest()).toBe('digest-old')

    await handshakeScopeContext()
    expect(posts).toBe(2)
    expect(getScopeContextDigest()).toBe('digest-new')
  })

  it('keeps quarantine after a same handshake while external-scope acknowledgement is pending', async () => {
    seedValidatedScopeContextForTests(
      { scopeContext: 'sc-old', scopeContextDigest: 'digest-old' },
      'lineage-1',
    )
    let posts = 0
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      if (!String(url).includes('/api/auth/scope-context')) {
        throw new Error(`unexpected ${url}`)
      }
      posts += 1
      return {
        ok: true,
        json: async () => ({
          scopeContext: 'sc-new',
          scopeContextDigest: 'digest-new',
          continuityDigest: 'lineage-1',
        }),
      } as Response
    })

    const first = await handshakeScopeContext({ force: true })
    expect(first.kind).toBe('external-scope')
    expect(isScopeContextQuarantined()).toBe(true)

    const second = await handshakeScopeContext()
    expect(second.kind).toBe('same')
    expect(posts).toBe(2)
    expect(isScopeContextQuarantined()).toBe(true)
    expect(isScopeExplicitRefreshRequired()).toBe(true)
  })

  it('clears external-scope acknowledgement on logout before the next session handshake', async () => {
    seedValidatedScopeContextForTests(
      { scopeContext: 'sc-old', scopeContextDigest: 'digest-old' },
      'lineage-1',
    )
    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      const target = String(url)
      if (target.includes('/api/auth/scope-context')) {
        return {
          ok: true,
          json: async () => ({
            scopeContext: 'sc-new',
            scopeContextDigest: 'digest-new',
            continuityDigest: 'lineage-1',
          }),
        } as Response
      }
      if (target.includes('/api/auth/logout')) {
        return { ok: true, json: async () => ({}) } as Response
      }
      throw new Error(`unexpected ${url}`)
    })

    const external = await handshakeScopeContext({ force: true })
    expect(external.kind).toBe('external-scope')
    expect(isScopeContextQuarantined()).toBe(true)

    await logoutScopeContextLineage()
    expect(getScopeContextDigest()).toBeUndefined()
    expect(isScopeExplicitRefreshRequired()).toBe(false)
    expect(isScopeContextQuarantined()).toBe(true)

    const session = await handshakeScopeContext({ force: true })
    expect(session.kind).toBe('session')
    expect(isScopeContextQuarantined()).toBe(false)
    expect(isScopeExplicitRefreshRequired()).toBe(false)
  })
})

describe('listQueryKeyForCurrentDigest', () => {
  beforeEach(() => {
    resetScopeContextClientForTests()
    seedValidatedScopeContextForTests({ scopeContext: 'sc-a', scopeContextDigest: 'digest-a' })
  })

  // Regression: refresh overwrote the last segment of every list key, so generic infinite lists never reloaded page one.
  it('leaves a list key that does not end in a scope digest unchanged', () => {
    const key = ['items', { filter: 'B' }]
    expect(listQueryKeyForCurrentDigest(key)).toBe(key)
  })

  it('rebinds a cursor-list key that ends in an earlier scope digest to the current digest', () => {
    seedValidatedScopeContextForTests({ scopeContext: 'sc-b', scopeContextDigest: 'digest-b' })
    expect(listQueryKeyForCurrentDigest(['inventory', 'cursor-list', {}, 'digest-a'])).toEqual([
      'inventory',
      'cursor-list',
      {},
      'digest-b',
    ])
  })
})
