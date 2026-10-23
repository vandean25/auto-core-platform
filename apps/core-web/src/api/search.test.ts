import { beforeEach, describe, expect, it, vi } from 'vitest'
import { fetchSearch, searchKeys } from './search'
import * as client from './client'

vi.mock('./client', () => ({ fetchWithAuth: vi.fn() }))

describe('fetchSearch', () => {
  beforeEach(() => {
    vi.mocked(client.fetchWithAuth).mockReset()
    vi.mocked(client.fetchWithAuth).mockResolvedValue(
      new Response(JSON.stringify({ groups: [] }), { status: 200 }),
    )
  })

  it('sends one GET /api/search with the encoded query and the abort signal', async () => {
    const controller = new AbortController()

    await expect(fetchSearch('RE-2026 0012', undefined, controller.signal)).resolves.toEqual({
      groups: [],
    })

    const [url, init] = vi.mocked(client.fetchWithAuth).mock.calls[0]
    expect(url).toBe('/api/search?q=RE-2026+0012')
    expect(init?.signal).toBe(controller.signal)
  })

  it('joins the types into one comma-separated parameter', async () => {
    await fetchSearch('golf', ['vehicle', 'stock_vehicle'])

    expect(vi.mocked(client.fetchWithAuth).mock.calls[0][0]).toBe(
      '/api/search?q=golf&types=vehicle%2Cstock_vehicle',
    )
  })

  it('throws when the request fails', async () => {
    vi.mocked(client.fetchWithAuth).mockResolvedValue(new Response('{}', { status: 500 }))

    await expect(fetchSearch('golf')).rejects.toThrow()
  })
})

describe('searchKeys', () => {
  it('includes the query and the types so each combination caches on its own', () => {
    expect(searchKeys.results('golf', ['vehicle'])).not.toEqual(searchKeys.results('golf', undefined))
    expect(searchKeys.results('golf', undefined)).not.toEqual(searchKeys.results('polo', undefined))
  })
})
