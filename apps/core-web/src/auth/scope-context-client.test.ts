import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

import { fetchWithAuth } from '@/api/client'
import {
  getScopeContextDigest,
  handshakeScopeContext,
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

    vi.mocked(fetchWithAuth).mockImplementation(async (url) => {
      if (String(url).includes('/api/auth/scope-context')) return handshakePromise
      if (String(url).includes('/api/auth/logout')) {
        return { ok: true, json: async () => ({}) } as Response
      }
      throw new Error(`unexpected ${url}`)
    })

    const inFlight = handshakeScopeContext({ force: true })
    await logoutScopeContextLineage()

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
})
