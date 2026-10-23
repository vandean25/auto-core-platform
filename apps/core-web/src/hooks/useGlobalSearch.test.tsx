import { act, renderHook, waitFor } from '@testing-library/react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import type { ReactNode } from 'react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { useGlobalSearch } from './useGlobalSearch'
import * as clientApi from '@/api/client'
import type { SearchResponse } from '@/api/search'

vi.mock('@/api/client', () => ({
  fetchWithAuth: vi.fn(),
}))

const customerGroup: SearchResponse = {
  groups: [
    {
      type: 'customer',
      results: [
        { type: 'customer', id: 'c-1', title: 'Erika Musterfrau', subtitle: null, href: '/customers/c-1', score: 1 },
      ],
    },
  ],
}

function createWrapper() {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } })
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

const mockFetch = () => vi.mocked(clientApi.fetchWithAuth)
const respond = (body: SearchResponse = customerGroup) =>
  mockFetch().mockImplementation(async () => new Response(JSON.stringify(body), { status: 200 }))
const calledUrls = () => mockFetch().mock.calls.map(([url]) => String(url))
const advance = (ms: number) => act(() => vi.advanceTimersByTimeAsync(ms))

describe('useGlobalSearch', () => {
  beforeEach(() => {
    vi.useFakeTimers()
    mockFetch().mockReset()
  })

  afterEach(() => {
    vi.useRealTimers()
  })

  it('sends no request for an empty input', async () => {
    const { result } = renderHook(() => useGlobalSearch(''), { wrapper: createWrapper() })
    await advance(1000)

    expect(mockFetch()).not.toHaveBeenCalled()
    expect(result.current).toMatchObject({ groups: [], isLoading: false, error: null })
  })

  it('debounces typing into exactly one GET /api/search', async () => {
    respond()
    const { result, rerender } = renderHook(({ input }) => useGlobalSearch(input), {
      wrapper: createWrapper(),
      initialProps: { input: '' },
    })

    rerender({ input: 'mu' })
    await advance(100)
    rerender({ input: 'mus' })
    await advance(100)
    rerender({ input: 'must' })
    expect(mockFetch()).not.toHaveBeenCalled()
    expect(result.current.isLoading).toBe(true)

    await advance(300)
    await advance(50)

    expect(calledUrls()).toEqual(['/api/search?q=must'])
    expect(result.current.groups).toEqual(customerGroup.groups)
    expect(result.current.isLoading).toBe(false)
  })

  it('does not search below the backend minimum length, but searches a single digit', async () => {
    respond()
    const { rerender } = renderHook(({ input }) => useGlobalSearch(input), {
      wrapper: createWrapper(),
      initialProps: { input: 'a' },
    })
    await advance(400)
    expect(mockFetch()).not.toHaveBeenCalled()

    rerender({ input: '7' })
    await advance(400)
    expect(calledUrls()).toEqual(['/api/search?q=7'])
  })

  it('turns a prefix into the types parameter and strips it from q', async () => {
    respond()
    renderHook(() => useGlobalSearch('fz: W-123'), { wrapper: createWrapper() })
    await advance(400)

    expect(calledUrls()).toEqual(['/api/search?q=W-123&types=vehicle%2Cstock_vehicle'])
  })

  it('does not search when only a prefix is typed', async () => {
    respond()
    renderHook(() => useGlobalSearch('k:'), { wrapper: createWrapper() })
    await advance(400)

    expect(mockFetch()).not.toHaveBeenCalled()
  })

  it('aborts the stale request when the input changes', async () => {
    const signals: AbortSignal[] = []
    mockFetch().mockImplementation(
      (_url, init) =>
        new Promise<Response>((_resolve, reject) => {
          const signal = init?.signal as AbortSignal
          signals.push(signal)
          signal.addEventListener('abort', () => reject(new DOMException('aborted', 'AbortError')))
        }),
    )
    const { rerender } = renderHook(({ input }) => useGlobalSearch(input), {
      wrapper: createWrapper(),
      initialProps: { input: 'mu' },
    })
    await advance(300)
    expect(signals).toHaveLength(1)

    rerender({ input: 'mus' })
    await advance(300)

    expect(signals).toHaveLength(2)
    expect(signals[0].aborted).toBe(true)
    expect(signals[1].aborted).toBe(false)
  })

  it('reports a failed request as an error with no groups', async () => {
    mockFetch().mockResolvedValue(new Response('{}', { status: 500 }))
    const { result } = renderHook(() => useGlobalSearch('mu'), { wrapper: createWrapper() })
    await advance(300)
    vi.useRealTimers()

    await waitFor(() => expect(result.current.error).toBeInstanceOf(Error))
    expect(result.current.groups).toEqual([])
  })

  it('keeps the groups of a group that failed next to the others', async () => {
    respond({
      groups: [{ type: 'customer', results: [], error: 'unavailable' }, ...customerGroup.groups.map((g) => ({ ...g, type: 'vehicle' as const }))],
    })
    const { result } = renderHook(() => useGlobalSearch('mu'), { wrapper: createWrapper() })
    await advance(300)

    expect(result.current.groups.map((group) => group.type)).toEqual(['customer', 'vehicle'])
    expect(result.current.error).toBeNull()
  })
})
