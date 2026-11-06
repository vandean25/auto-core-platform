import type { ReactNode } from 'react'
import type { InfiniteData } from '@tanstack/react-query'
import { QueryClient, QueryClientProvider, useInfiniteQuery, useMutation, useQuery } from '@tanstack/react-query'
import { act, fireEvent, renderHook, screen, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { boardKeys, useBoardActive, workshopKeys } from '@/api/workshop'
import type { AssignBoardPayload, BoardActiveResponse } from '@/api/workshop'
import { fetchWithAuth } from '@/api/client'
import { mechanicQueueKeys } from '@/api/mechanic'
import { InfiniteListRefreshNotice } from '@/components/list/InfiniteListRefreshNotice'
import { RealtimeDashboardSyncProvider } from '@/features/realtime/RealtimeDashboardSyncProvider'
import { ENTITY_UPDATED_EVENT } from '@/features/realtime/types'
import { infiniteListQueryMeta, refreshInfiniteList } from '@/lib/infinite-list-query'
import { optimisticMutationOptions } from '@/lib/optimistic-mutation'
import { deWorkshop } from '@/test/de-workshop'
import { registerGermanUiForTests } from '@/test/german-ui'

registerGermanUiForTests()

const mocks = vi.hoisted(() => ({
  socket: { on: vi.fn(), off: vi.fn(), disconnect: vi.fn(), connect: vi.fn(), active: false },
  token: 'token',
}))

vi.mock('socket.io-client', () => ({ io: () => mocks.socket }))
vi.mock('sonner', () => ({ toast: { error: vi.fn(), success: vi.fn() } }))
vi.mock('@/api/client', () => ({ API_BASE_URL: 'http://127.0.0.1:3000', fetchWithAuth: vi.fn() }))
vi.mock('@/lib/firebase', () => ({ firebaseAuth: { currentUser: null }, firebaseConfigMissing: false }))
vi.mock('@/auth/AuthProvider', () => ({
  useAuth: () => ({ user: { getIdToken: () => Promise.resolve(mocks.token) }, signOutUser: vi.fn() }),
}))

type Order = { id: string; mechanicId: string | null; bayId: string | null }
type Request = { url: string; method: string; body: unknown; respond: (status: number, body?: unknown) => void }

const BOARD_URL = '/api/workshop/board/active'
const ASSIGN_URL = '/api/workshop/board/assign'
const QUEUE_URL = '/api/test/queue'
const PLANNER_URL = '/api/test/planner'
const OTHER_URL = '/api/test/other'

/** Every fetch is a controlled promise: the test decides when and how each request answers. */
let requests: Request[]

function pending(url: string, method = 'GET') {
  return requests.filter((request) => request.url === url && request.method === method)
}

/** Answers the newest unanswered request (a refetch that was cancelled and restarted leaves an older, ignored one). */
function nextRequest(url: string, method = 'GET'): Request {
  const request = pending(url, method).filter((candidate) => !answered.has(candidate)).at(-1)
  if (!request) throw new Error(`no pending ${method} ${url}`)
  answered.add(request)
  return request
}
let answered: Set<Request>

function board(...orders: Order[]) {
  return { data: orders }
}

async function respond(url: string, method: string, status: number, body: unknown) {
  nextRequest(url, method).respond(status, body)
  await settle()
}

/** Lets promise callbacks and TanStack's batched (setTimeout 0) notifications run. */
const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

function emit(type: 'WORKSHOP_ORDER' | 'WORKSHOP_TASK') {
  const handler = mocks.socket.on.mock.calls.filter(([event]) => event === ENTITY_UPDATED_EVENT).at(-1)?.[1] as
    | ((payload: unknown) => void)
    | undefined
  act(() => handler?.({ type, action: 'UPDATED', entityId: 'order-1', timestamp: '2026-05-01T10:00:00.000Z' }))
}

const orderOne = (mechanicId: string | null = null): Order => ({ id: 'order-1', mechanicId, bayId: null })
const orderTwo = (mechanicId: string | null = null): Order => ({ id: 'order-2', mechanicId, bayId: null })

/**
 * Optimistic vehicle for the helper tests. The real board assign (`useAssignBoard`) is server-confirmed since
 * AUT-882, so the helper's ordering, rollback and echo rules are exercised on an equivalent card move here.
 */
function useOptimisticBoardMove() {
  const { mutateAsync } = useMutation({
    ...optimisticMutationOptions<BoardActiveResponse, AssignBoardPayload>({
      queryKey: boardKeys.active(),
      mutationKey: [...boardKeys.active(), 'assign'],
      entityId: ({ orderId }) => orderId,
      apply: (cache, { orderId, mechanicId }) => ({
        ...cache,
        data: cache.data.map((order) => (order.id === orderId ? { ...order, mechanicId } : order)),
      }),
      revert: (cache, { orderId }, snapshot) => {
        const before = snapshot.data.find((order) => order.id === orderId)
        if (!before) return cache
        return {
          ...cache,
          data: cache.data.map((order) =>
            order.id === orderId ? { ...order, mechanicId: before.mechanicId } : order,
          ),
        }
      },
    }),
    mutationFn: async (payload: AssignBoardPayload) => {
      const response = await fetchWithAuth(ASSIGN_URL, { method: 'PATCH', body: JSON.stringify(payload) })
      if (!response.ok) throw new Error('Failed to assign board')
      return response.json() as Promise<unknown>
    },
  })
  return (orderId: string, target: { id: string }) => {
    mutateAsync({ orderId, mechanicId: target.id }).catch(() => toast.error(deWorkshop.board.assignError))
  }
}

async function setup(initial: Order[]) {
  const queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
  const wrapper = ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>
      <RealtimeDashboardSyncProvider>{children}</RealtimeDashboardSyncProvider>
    </QueryClientProvider>
  )
  const view = renderHook(
    () => ({
      board: useBoardActive(),
      assign: useOptimisticBoardMove(),
      queue: useQuery({
        queryKey: [...mechanicQueueKeys.queue(), 'test'],
        queryFn: async () => (await fetchWithAuth(QUEUE_URL)).json() as Promise<unknown>,
      }),
      // Under ['workshop'] like the board, but not refetched by the assign mutation itself.
      planner: useQuery({
        queryKey: workshopKeys.planner(),
        queryFn: async () => (await fetchWithAuth(PLANNER_URL)).json() as Promise<unknown>,
      }),
      // A second optimistic mutation on the board query, with its own mutation key and scope.
      other: useMutation({
        ...optimisticMutationOptions<BoardActiveResponse, { orderId: string }>({
          queryKey: boardKeys.active(),
          mutationKey: [...boardKeys.active(), 'other'],
          entityId: ({ orderId }) => orderId,
          apply: (cache) => cache,
          revert: (cache) => cache,
        }),
        mutationFn: async () => (await fetchWithAuth(OTHER_URL, { method: 'POST' })).json() as Promise<unknown>,
      }),
    }),
    { wrapper },
  )
  await waitFor(() => expect(mocks.socket.on).toHaveBeenCalledWith(ENTITY_UPDATED_EVENT, expect.any(Function)))
  await respond(BOARD_URL, 'GET', 200, board(...initial))
  await respond(QUEUE_URL, 'GET', 200, [])
  await respond(PLANNER_URL, 'GET', 200, [])
  await waitFor(() => expect(view.result.current.board.data).toBeDefined())

  // Every value the board cache ever holds from here on, to prove it never flickers.
  const seen: Array<Record<string, string | null>> = []
  queryClient.getQueryCache().subscribe(() => {
    const data = queryClient.getQueryData<BoardActiveResponse>(workshopKeys.boardActive())
    seen.push(Object.fromEntries((data?.data ?? []).map((order) => [order.id, order.mechanicId ?? null])))
  })
  const mechanicOf = (id: string) =>
    view.result.current.board.data?.data.find((order) => order.id === id)?.mechanicId
  const drag = async (orderId: string, mechanicId: string) => {
    act(() => view.result.current.assign(orderId, { id: mechanicId }))
    await settle()
  }
  return { view, queryClient, seen, mechanicOf, drag }
}

describe('optimistic board assignment vs. realtime echo', () => {
  beforeEach(() => {
    vi.clearAllMocks()
    requests = []
    answered = new Set()
    mocks.token = 'token'
    vi.mocked(fetchWithAuth).mockImplementation(
      (input, init) =>
        new Promise<Response>((resolve) => {
          requests.push({
            url: String(input),
            method: init?.method ?? 'GET',
            body: init?.body ? JSON.parse(String(init.body)) : undefined,
            respond: (status, body = {}) =>
              resolve({ ok: status < 400, status, json: async () => body } as Response),
          })
        }),
    )
  })

  afterEach(() => {
    vi.restoreAllMocks()
  })

  it('moves the card immediately, before the server answers', async () => {
    const { mechanicOf, drag } = await setup([orderOne()])

    await drag('order-1', 'mech-2')

    expect(mechanicOf('order-1')).toBe('mech-2')
    expect(pending(ASSIGN_URL, 'PATCH')[0]?.body).toEqual({ orderId: 'order-1', mechanicId: 'mech-2' })
  })

  it('(a) skips an echo that arrives before the response and refetches once the drag has settled', async () => {
    const { mechanicOf, drag, seen } = await setup([orderOne()])
    await drag('order-1', 'mech-2')
    seen.length = 0

    emit('WORKSHOP_ORDER')
    await settle()
    expect(pending(BOARD_URL)).toHaveLength(1) // only the initial load: the echo did not refetch
    expect(mechanicOf('order-1')).toBe('mech-2')

    await respond(ASSIGN_URL, 'PATCH', 200, {})
    await waitFor(() => expect(pending(BOARD_URL).length).toBeGreaterThan(1)) // deferred echo flushed
    await respond(BOARD_URL, 'GET', 200, board(orderOne('mech-2')))

    expect(mechanicOf('order-1')).toBe('mech-2')
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((snapshot) => snapshot['order-1'] === 'mech-2')).toBe(true)
  })

  it('(b) an echo after the response refetches without snapping back or moving twice', async () => {
    const { mechanicOf, drag, seen } = await setup([orderOne()])
    await drag('order-1', 'mech-2')
    await respond(ASSIGN_URL, 'PATCH', 200, {})
    await waitFor(() => expect(pending(BOARD_URL)).toHaveLength(2))
    await respond(BOARD_URL, 'GET', 200, board(orderOne('mech-2')))
    seen.length = 0

    emit('WORKSHOP_ORDER')
    await waitFor(() => expect(pending(BOARD_URL)).toHaveLength(3))
    expect(mechanicOf('order-1')).toBe('mech-2')
    await respond(BOARD_URL, 'GET', 200, board(orderOne('mech-2')))

    expect(mechanicOf('order-1')).toBe('mech-2')
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((snapshot) => snapshot['order-1'] === 'mech-2')).toBe(true)
    expect(pending(ASSIGN_URL, 'PATCH')).toHaveLength(1)
  })

  it('(c) two quick drags of one card end on the last intent and refetch only after both settled', async () => {
    const { mechanicOf, drag, seen } = await setup([orderOne()])

    await drag('order-1', 'mech-1')
    await drag('order-1', 'mech-2')
    seen.length = 0
    expect(mechanicOf('order-1')).toBe('mech-2')
    expect(pending(ASSIGN_URL, 'PATCH')).toHaveLength(1) // serialized: the second PATCH waits for the first

    await respond(ASSIGN_URL, 'PATCH', 200, {})
    await waitFor(() => expect(pending(ASSIGN_URL, 'PATCH')).toHaveLength(2))
    expect(pending(BOARD_URL)).toHaveLength(1) // the first settle must not refetch while the second is pending
    expect(mechanicOf('order-1')).toBe('mech-2')

    emit('WORKSHOP_ORDER') // an echo of the first move, arriving late and out of order
    await settle()
    expect(pending(BOARD_URL)).toHaveLength(1)

    await respond(ASSIGN_URL, 'PATCH', 200, {})
    await waitFor(() => expect(pending(BOARD_URL).length).toBeGreaterThan(1))
    await respond(BOARD_URL, 'GET', 200, board(orderOne('mech-2')))

    expect(mechanicOf('order-1')).toBe('mech-2')
    expect(seen.length).toBeGreaterThan(0)
    expect(seen.every((snapshot) => snapshot['order-1'] === 'mech-2')).toBe(true)
  })

  it('(c) cancels an older in-flight refetch so its stale answer cannot overwrite the optimistic move', async () => {
    const { mechanicOf, drag } = await setup([orderOne()])
    emit('WORKSHOP_ORDER') // no drag yet: refetches at once, and the answer is still on its way
    await waitFor(() => expect(pending(BOARD_URL)).toHaveLength(2))

    await drag('order-1', 'mech-2')
    await respond(BOARD_URL, 'GET', 200, board(orderOne())) // stale: server state from before the drag
    await settle()

    expect(mechanicOf('order-1')).toBe('mech-2')
  })

  it.each([403, 409])('(d) rolls back and shows the error toast when the server answers %i', async (status) => {
    const { mechanicOf, drag } = await setup([orderOne()])
    await drag('order-1', 'mech-2')
    expect(mechanicOf('order-1')).toBe('mech-2')

    await respond(ASSIGN_URL, 'PATCH', status, { message: 'rejected' })

    await waitFor(() => expect(mechanicOf('order-1')).toBeNull())
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(deWorkshop.board.assignError))
    await waitFor(() => expect(pending(BOARD_URL)).toHaveLength(2)) // settled: refetch for server truth
  })

  it("(d) a rollback restores only its own card and keeps another card's pending move", async () => {
    const { mechanicOf, drag } = await setup([orderOne(), orderTwo()])
    await drag('order-1', 'mech-2') // will fail
    await drag('order-2', 'mech-1') // queued behind it, still optimistic

    await respond(ASSIGN_URL, 'PATCH', 403, { message: 'forbidden' })

    await waitFor(() => expect(mechanicOf('order-1')).toBeNull())
    expect(mechanicOf('order-2')).toBe('mech-1')
    expect(pending(BOARD_URL)).toHaveLength(1) // order-2 is still pending: no refetch yet
  })

  it('(d) a failed older drag does not undo a newer drag of the same card', async () => {
    const { mechanicOf, drag } = await setup([orderOne()])
    await drag('order-1', 'mech-1') // will fail
    await drag('order-1', 'mech-2')

    await respond(ASSIGN_URL, 'PATCH', 409, { message: 'conflict' })
    await settle()

    expect(mechanicOf('order-1')).toBe('mech-2')
    expect(toast.error).toHaveBeenCalledTimes(1) // the first drag's failure still toasts after the second call
  })

  it('(e) applies echoes of other entities and other users during a drag once it has settled', async () => {
    const { mechanicOf, drag } = await setup([orderOne(), orderTwo()])
    await drag('order-1', 'mech-2')

    emit('WORKSHOP_TASK') // e.g. another user's change
    await waitFor(() => expect(pending(QUEUE_URL)).toHaveLength(2)) // not under the pending mutation: applied at once
    await settle()
    expect(pending(BOARD_URL)).toHaveLength(1) // under ['workshop']: deferred while the drag is in flight...
    expect(pending(PLANNER_URL)).toHaveLength(1)

    await respond(ASSIGN_URL, 'PATCH', 200, {})
    await waitFor(() => expect(pending(PLANNER_URL)).toHaveLength(2)) // ...and flushed, not dropped, once it settled
    await waitFor(() => expect(pending(BOARD_URL).length).toBeGreaterThan(1))
    // Another user moved order-2 in the meantime: the deferred refetch brings it in, our move stays.
    await respond(BOARD_URL, 'GET', 200, board(orderOne('mech-2'), orderTwo('mech-1')))

    await waitFor(() => expect(mechanicOf('order-2')).toBe('mech-1'))
    expect(mechanicOf('order-1')).toBe('mech-2')
  })

  it('(c2) a second mutation of the board settling does not refetch over a pending drag', async () => {
    const { view, drag, mechanicOf } = await setup([orderOne()])
    await drag('order-1', 'mech-2')

    act(() => view.result.current.other.mutate({ orderId: 'order-2' }))
    await settle()
    await respond(OTHER_URL, 'POST', 200, {})

    expect(pending(BOARD_URL)).toHaveLength(1) // the drag is still pending: its optimistic state is not refetched over
    expect(mechanicOf('order-1')).toBe('mech-2')

    await respond(ASSIGN_URL, 'PATCH', 200, {})
    await waitFor(() => expect(pending(BOARD_URL).length).toBeGreaterThan(1))
  })

  it('(d2) A to B, B to A, A to B with the first rejected: the card stays on B', async () => {
    const { mechanicOf, drag, seen } = await setup([orderOne('mech-1')])
    await drag('order-1', 'mech-2')
    await drag('order-1', 'mech-1')
    await drag('order-1', 'mech-2')
    seen.length = 0

    await respond(ASSIGN_URL, 'PATCH', 403, { message: 'forbidden' }) // the first drag fails
    await waitFor(() => expect(toast.error).toHaveBeenCalledTimes(1))

    expect(mechanicOf('order-1')).toBe('mech-2')
    expect(seen.every((snapshot) => snapshot['order-1'] === 'mech-2')).toBe(true)

    await respond(ASSIGN_URL, 'PATCH', 200, {})
    await respond(ASSIGN_URL, 'PATCH', 200, {})
    await waitFor(() => expect(pending(BOARD_URL).length).toBeGreaterThan(1))
    await respond(BOARD_URL, 'GET', 200, board(orderOne('mech-2')))
    await waitFor(() => expect(mechanicOf('order-1')).toBe('mech-2'))
  })

  it('(e2) a foreign echo held during a drag that then fails is applied after the rollback', async () => {
    const { mechanicOf, drag } = await setup([orderOne(), orderTwo()])
    await drag('order-1', 'mech-2')

    emit('WORKSHOP_ORDER') // another user moved order-2
    await settle()
    expect(pending(BOARD_URL)).toHaveLength(1)
    expect(pending(PLANNER_URL)).toHaveLength(1)

    await respond(ASSIGN_URL, 'PATCH', 409, { message: 'conflict' })
    // The planner is under ['workshop'] but not refetched by the drag itself: only the flush can refetch it.
    await waitFor(() => expect(pending(PLANNER_URL)).toHaveLength(2))
    await waitFor(() => expect(pending(BOARD_URL).length).toBeGreaterThan(1))
    await respond(BOARD_URL, 'GET', 200, board(orderOne(), orderTwo('mech-1')))

    await waitFor(() => expect(mechanicOf('order-2')).toBe('mech-1'))
    expect(mechanicOf('order-1')).toBeNull()
  })

  it('a token refresh (socket teardown) while a drag is pending keeps held echoes held', async () => {
    const { view, drag, mechanicOf } = await setup([orderOne()])
    await drag('order-1', 'mech-2')
    emit('WORKSHOP_ORDER')
    await settle()

    const disconnects = mocks.socket.disconnect.mock.calls.length
    mocks.token = 'token-2'
    view.rerender()
    await waitFor(() => expect(mocks.socket.disconnect.mock.calls.length).toBeGreaterThan(disconnects))
    await settle()
    expect(pending(BOARD_URL)).toHaveLength(1)
    expect(mechanicOf('order-1')).toBe('mech-2')

    await respond(ASSIGN_URL, 'PATCH', 200, {})
    await waitFor(() => expect(pending(BOARD_URL).length).toBeGreaterThan(1))
  })

  it('unmounting while a drag is pending still invalidates the held echoes', async () => {
    const { view, queryClient, drag } = await setup([orderOne()])
    await drag('order-1', 'mech-2')
    emit('WORKSHOP_ORDER')
    await settle()
    const invalidate = vi.spyOn(queryClient, 'invalidateQueries')

    view.unmount()

    expect(invalidate).toHaveBeenCalledWith({ queryKey: workshopKeys.all, refetchType: 'active' })
  })

  it('invalidates non-busy extra keys even when the primary queryKey has another pending mutation', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const primaryKey = ['test', 'primary'] as const
    const busyExtraKey = ['test', 'busy-extra'] as const
    const freeExtraKey = ['test', 'free-extra'] as const
    queryClient.setQueryData(primaryKey, { count: 0 })
    queryClient.setQueryData(busyExtraKey, { count: 0 })
    queryClient.setQueryData(freeExtraKey, { count: 0 })

    let resolveBusy: (() => void) | undefined
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => ({
        busyOnPrimaryAndFirstExtra: useMutation({
          ...optimisticMutationOptions<{ count: number }, { id: string }>({
            queryKey: primaryKey,
            mutationKey: [...primaryKey, 'busy'],
            entityId: ({ id }) => id,
            apply: (c) => c,
            revert: (c) => c,
            extraCaches: [
              {
                queryKey: () => busyExtraKey,
                apply: (c) => c,
                revert: (c) => c,
              },
            ],
          }),
          mutationFn: () =>
            new Promise<void>((resolve) => {
              resolveBusy = resolve
            }),
        }),
        settlingWithExtraKeys: useMutation({
          ...optimisticMutationOptions<{ count: number }, { id: string }>({
            queryKey: primaryKey,
            mutationKey: [...primaryKey, 'settling'],
            entityId: ({ id }) => id,
            apply: (c) => c,
            revert: (c) => c,
            extraCaches: [
              {
                queryKey: () => busyExtraKey,
                apply: (c) => c,
                revert: (c) => c,
              },
              {
                queryKey: () => freeExtraKey,
                apply: (c) => c,
                revert: (c) => c,
              },
            ],
          }),
          mutationFn: async () => undefined,
        }),
      }),
      { wrapper },
    )

    act(() => {
      result.current.busyOnPrimaryAndFirstExtra.mutate({ id: '1' })
    })
    await settle()

    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')
    await act(async () => {
      await result.current.settlingWithExtraKeys.mutateAsync({ id: '2' })
    })

    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: primaryKey })
    expect(invalidateSpy).not.toHaveBeenCalledWith({ queryKey: busyExtraKey })
    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: freeExtraKey })

    await act(async () => {
      resolveBusy?.()
    })
  })
})

describe('AUT-895 infinite-list optimistic settlement (ADR-0036 R7)', () => {
  type Item = { id: string; label: string }
  type ListPage = { data: Item[]; meta: { next_cursor: string | null } }

  const infiniteListKey = ['aut895', 'infinite'] as const
  const infiniteCountKey = ['aut895', 'infinite', 'count'] as const
  const offsetListKey = ['aut895', 'offset'] as const
  const LIST_URL = 'http://127.0.0.1:3000/api/aut895/infinite'
  const COUNT_URL = 'http://127.0.0.1:3000/api/aut895/infinite/count'
  const OFFSET_URL = 'http://127.0.0.1:3000/api/aut895/offset'
  const PATCH_URL = 'http://127.0.0.1:3000/api/aut895/patch'

  const pageOne: ListPage = {
    data: [
      { id: 'row-a', label: 'Alpha' },
      { id: 'row-b', label: 'Beta' },
    ],
    meta: { next_cursor: 'cursor-page-2' },
  }
  const pageTwo: ListPage = {
    data: [{ id: 'row-c', label: 'Gamma' }],
    meta: { next_cursor: null },
  }

  const seededInfinite = (): InfiniteData<ListPage> => ({
    pages: [pageOne, pageTwo],
    pageParams: [undefined, 'cursor-page-2'],
  })

  let listGetUrls: string[]
  let countGets: number

  beforeEach(() => {
    listGetUrls = []
    countGets = 0
    vi.mocked(fetchWithAuth).mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method === 'GET' && url === LIST_URL) {
        listGetUrls.push(url)
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => pageOne,
        } as Response)
      }
      if (method === 'GET' && url === COUNT_URL) {
        countGets += 1
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ count: 3, isCapped: false }),
        } as Response)
      }
      if (method === 'GET' && url === OFFSET_URL) {
        listGetUrls.push(url)
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'row-a', label: 'Alpha' }] }),
        } as Response)
      }
      if (method === 'PATCH' && url === PATCH_URL) {
        return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
    })
  })

  function renderInfiniteMutationHarness(options: {
    apply: (cache: InfiniteData<ListPage>, variables: { id: string; label: string }) => InfiniteData<ListPage>
    shouldOptimistic?: (variables: { id: string; label: string }) => boolean
  }) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(infiniteCountKey, { count: 3, isCapped: false })

    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        {children}
        <InfiniteListRefreshNotice queryKey={infiniteListKey} />
      </QueryClientProvider>
    )

    const view = renderHook(
      () => {
        const list = useInfiniteQuery({
          queryKey: infiniteListKey,
          meta: infiniteListQueryMeta(infiniteCountKey),
          initialPageParam: undefined as string | undefined,
          queryFn: async ({ pageParam }) => {
            const url = pageParam === undefined ? LIST_URL : `${LIST_URL}?cursor=${String(pageParam)}`
            return (await (await fetchWithAuth(url)).json()) as ListPage
          },
          getNextPageParam: (lastPage) => lastPage.meta.next_cursor ?? undefined,
          staleTime: Infinity,
          initialData: seededInfinite(),
        })
        useQuery({
          queryKey: infiniteCountKey,
          queryFn: async () =>
            (await (await fetchWithAuth(COUNT_URL)).json()) as { count: number; isCapped: boolean },
          staleTime: Infinity,
          initialData: { count: 3, isCapped: false },
        })
        const mutation = useMutation({
          ...optimisticMutationOptions<InfiniteData<ListPage>, { id: string; label: string }>({
            queryKey: infiniteListKey,
            mutationKey: [...infiniteListKey, 'patch'],
            entityId: ({ id }) => id,
            apply: options.apply,
            revert: (_cache, _variables, snapshot) => snapshot,
            shouldOptimistic: options.shouldOptimistic,
          }),
          mutationFn: async () => (await fetchWithAuth(PATCH_URL, { method: 'PATCH' })).json() as Promise<unknown>,
        })
        return { list, mutation }
      },
      { wrapper },
    )

    return { view, queryClient }
  }

  it('marks an infinite list stale on settle without refetching retained pages', async () => {
    const { view, queryClient } = renderInfiniteMutationHarness({
      shouldOptimistic: () => false,
      apply: (cache) => cache,
    })
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await view.result.current.mutation.mutateAsync({ id: 'row-a', label: 'ignored' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({
      queryKey: infiniteListKey,
      exact: true,
      refetchType: 'none',
    })
    expect(listGetUrls).toHaveLength(0)
    expect(queryClient.getQueryCache().find({ queryKey: infiniteListKey, exact: true })?.state.isInvalidated).toBe(
      true,
    )
    expect(screen.getByRole('button', { name: 'Liste aktualisieren' })).toBeInTheDocument()
  })

  it('keeps a field-only patch visible without refetching retained pages', async () => {
    const { view, queryClient } = renderInfiniteMutationHarness({
      apply: (cache, { id, label }) => ({
        ...cache,
        pages: cache.pages.map((page) => ({
          ...page,
          data: page.data.map((row) => (row.id === id ? { ...row, label } : row)),
        })),
      }),
    })

    await act(async () => {
      await view.result.current.mutation.mutateAsync({ id: 'row-b', label: 'Beta-updated' })
    })

    const flat = queryClient
      .getQueryData<InfiniteData<ListPage>>(infiniteListKey)
      ?.pages.flatMap((page) => page.data)
    expect(flat?.find((row) => row.id === 'row-b')?.label).toBe('Beta-updated')
    expect(listGetUrls).toHaveLength(0)
    expect(screen.queryByRole('button', { name: 'Liste aktualisieren' })).not.toBeInTheDocument()
  })

  const membershipChanges: Array<{
    change: 'tail-insert' | 'middle-insert' | 'removal' | 'reorder'
    apply: (cache: InfiniteData<ListPage>) => InfiniteData<ListPage>
  }> = [
    {
      change: 'tail-insert',
      apply: (cache) => ({
        ...cache,
        pages: cache.pages.map((page, index) =>
          index === cache.pages.length - 1
            ? { ...page, data: [...page.data, { id: 'row-new', label: 'New' }] }
            : page,
        ),
      }),
    },
    {
      change: 'middle-insert',
      apply: (cache) => ({
        ...cache,
        pages: cache.pages.map((page, index) =>
          index === 0
            ? { ...page, data: [page.data[0]!, { id: 'row-new', label: 'New' }, ...page.data.slice(1)] }
            : page,
        ),
      }),
    },
    {
      change: 'removal',
      apply: (cache) => ({
        ...cache,
        pages: cache.pages.map((page, index) =>
          index === 0 ? { ...page, data: page.data.slice(1) } : page,
        ),
      }),
    },
    {
      change: 'reorder',
      apply: (cache) => ({
        ...cache,
        pages: [{ ...pageOne, data: [...pageOne.data].reverse() }, pageTwo],
      }),
    },
  ]

  it.each(membershipChanges)('reverts a $change and shows the refresh notice', async ({ apply }) => {
    const { view, queryClient } = renderInfiniteMutationHarness({ apply })

    await act(async () => {
      await view.result.current.mutation.mutateAsync({ id: 'row-a', label: 'ignored' })
    })

    const flat = queryClient
      .getQueryData<InfiniteData<ListPage>>(infiniteListKey)
      ?.pages.flatMap((page) => page.data.map((row) => row.id))
    expect(flat).toEqual(['row-a', 'row-b', 'row-c'])
    expect(listGetUrls).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Liste aktualisieren' })).toBeInTheDocument()
  })

  it('keeps offset-list settlement on invalidateQueries refetch', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(
      () => {
        useQuery({
          queryKey: offsetListKey,
          queryFn: async () => (await (await fetchWithAuth(OFFSET_URL)).json()) as { data: Item[] },
          staleTime: Infinity,
          initialData: { data: [{ id: 'row-a', label: 'Alpha' }] },
        })
        return useMutation({
          ...optimisticMutationOptions<{ data: Item[] }, { id: string; label: string }>({
            queryKey: offsetListKey,
            mutationKey: [...offsetListKey, 'patch'],
            entityId: ({ id }) => id,
            apply: (cache, { id, label }) => ({
              ...cache,
              data: cache.data.map((row) => (row.id === id ? { ...row, label } : row)),
            }),
            revert: (_cache, _variables, snapshot) => snapshot,
          }),
          mutationFn: async () => (await fetchWithAuth(PATCH_URL, { method: 'PATCH' })).json() as Promise<unknown>,
        })
      },
      { wrapper },
    )
    const invalidateSpy = vi.spyOn(queryClient, 'invalidateQueries')

    await act(async () => {
      await result.current.mutateAsync({ id: 'row-a', label: 'Alpha-updated' })
    })

    expect(invalidateSpy).toHaveBeenCalledWith({ queryKey: offsetListKey })
    expect(invalidateSpy).not.toHaveBeenCalledWith(
      expect.objectContaining({ queryKey: offsetListKey, refetchType: 'none' }),
    )
    await waitFor(() => expect(listGetUrls).toEqual([OFFSET_URL]))
  })

  it('reloads page one and the count when the user clicks Liste aktualisieren', async () => {
    const { view } = renderInfiniteMutationHarness({
      shouldOptimistic: () => false,
      apply: (cache) => cache,
    })

    await act(async () => {
      await view.result.current.mutation.mutateAsync({ id: 'row-a', label: 'ignored' })
    })

    listGetUrls.length = 0
    countGets = 0

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Liste aktualisieren' }))
    })

    await waitFor(() => expect(listGetUrls).toEqual([LIST_URL]))
    await waitFor(() => expect(countGets).toBe(1))
    await waitFor(() => expect(view.result.current.list.data?.pages).toHaveLength(1))
    expect(screen.queryByRole('button', { name: 'Liste aktualisieren' })).not.toBeInTheDocument()
  })

  it('keeps the loaded chain and the refresh notice when page one fails', async () => {
    const { view, queryClient } = renderInfiniteMutationHarness({
      shouldOptimistic: () => false,
      apply: (cache) => cache,
    })
    await act(async () => {
      await view.result.current.mutation.mutateAsync({ id: 'row-a', label: 'ignored' })
    })
    vi.mocked(fetchWithAuth).mockImplementation((input) => {
      if (String(input) === LIST_URL) return Promise.reject(new Error('offline'))
      return Promise.resolve({ ok: true, status: 200, json: async () => ({ count: 3, isCapped: false }) } as Response)
    })

    await act(async () => {
      fireEvent.click(screen.getByRole('button', { name: 'Liste aktualisieren' }))
    })

    await waitFor(() => expect(view.result.current.list.data?.pages).toHaveLength(2))
    expect(queryClient.getQueryData<InfiniteData<ListPage>>(infiniteListKey)?.pages).toHaveLength(2)
    expect(screen.getByRole('button', { name: 'Liste aktualisieren' })).toBeInTheDocument()
  })

  it('keeps a page loaded during a field patch instead of reverting it', async () => {
    let releasePatch: (() => void) | undefined
    vi.mocked(fetchWithAuth).mockImplementation((input, init) => {
      const url = String(input)
      if ((init?.method ?? 'GET') === 'PATCH') {
        return new Promise<Response>((resolve) => {
          releasePatch = () => resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
        })
      }
      if (url === `${LIST_URL}?cursor=cursor-page-3`) {
        return Promise.resolve({
          ok: true,
          status: 200,
          json: async () => ({ data: [{ id: 'row-d', label: 'Delta' }], meta: { next_cursor: null } }),
        } as Response)
      }
      return Promise.resolve({ ok: true, status: 200, json: async () => pageOne } as Response)
    })
    const { view, queryClient } = renderInfiniteMutationHarness({
      apply: (cache, { id, label }) => ({
        ...cache,
        pages: cache.pages.map((page) => ({
          ...page,
          data: page.data.map((row) => (row.id === id ? { ...row, label } : row)),
        })),
      }),
    })
    queryClient.setQueryData<InfiniteData<ListPage>>(infiniteListKey, {
      pages: [pageOne, { ...pageTwo, meta: { next_cursor: 'cursor-page-3' } }],
      pageParams: [undefined, 'cursor-page-2'],
    })

    act(() => {
      view.result.current.mutation.mutate({ id: 'row-b', label: 'Beta-updated' })
    })
    await settle()
    await act(async () => {
      await view.result.current.list.fetchNextPage()
    })
    await act(async () => {
      releasePatch?.()
    })

    await waitFor(() => expect(view.result.current.mutation.isSuccess).toBe(true))
    const ids = view.result.current.list.data?.pages.flatMap((page) => page.data.map((row) => row.id))
    expect(ids).toEqual(['row-a', 'row-b', 'row-c', 'row-d'])
    expect(view.result.current.list.data?.pages[0]?.data[1]?.label).toBe('Beta-updated')
    expect(screen.queryByRole('button', { name: 'Liste aktualisieren' })).not.toBeInTheDocument()
  })

  it('keeps an earlier reorder from surviving a later field-only settle', async () => {
    let releaseReorder: (() => void) | undefined
    let releaseField: (() => void) | undefined
    vi.mocked(fetchWithAuth).mockImplementation((input, init) => {
      const url = String(input)
      const method = init?.method ?? 'GET'
      if (method === 'POST' && url.endsWith('/reorder')) {
        return new Promise<Response>((resolve) => {
          releaseReorder = () => resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
        })
      }
      if (method === 'POST' && url.endsWith('/field')) {
        return new Promise<Response>((resolve) => {
          releaseField = () => resolve({ ok: true, status: 200, json: async () => ({}) } as Response)
        })
      }
      return Promise.resolve({
        ok: true,
        status: 200,
        json: async () => pageOne,
      } as Response)
    })
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        {children}
        <InfiniteListRefreshNotice queryKey={infiniteListKey} />
      </QueryClientProvider>
    )
    const { result } = renderHook(
      () => {
        useInfiniteQuery({
          queryKey: infiniteListKey,
          meta: infiniteListQueryMeta(infiniteCountKey),
          initialPageParam: undefined as string | undefined,
          queryFn: async () => (await (await fetchWithAuth(LIST_URL)).json()) as ListPage,
          getNextPageParam: (lastPage) => lastPage.meta.next_cursor ?? undefined,
          staleTime: Infinity,
          initialData: seededInfinite(),
        })
        const reorder = useMutation({
          ...optimisticMutationOptions<InfiniteData<ListPage>, { id: string }>({
            queryKey: infiniteListKey,
            mutationKey: [...infiniteListKey, 'reorder'],
            entityId: ({ id }) => id,
            apply: (cache) => ({
              ...cache,
              pages: [{ ...pageOne, data: [...pageOne.data].reverse() }, pageTwo],
            }),
            revert: (_cache, _variables, snapshot) => snapshot,
          }),
          mutationFn: async () => (await fetchWithAuth(`${PATCH_URL}/reorder`, { method: 'POST' })).json(),
        })
        const field = useMutation({
          ...optimisticMutationOptions<InfiniteData<ListPage>, { id: string; label: string }>({
            queryKey: infiniteListKey,
            mutationKey: [...infiniteListKey, 'field'],
            entityId: ({ id }) => id,
            apply: (cache, { id, label }) => ({
              ...cache,
              pages: cache.pages.map((page) => ({
                ...page,
                data: page.data.map((row) => (row.id === id ? { ...row, label } : row)),
              })),
            }),
            revert: (_cache, _variables, snapshot) => snapshot,
          }),
          mutationFn: async () => (await fetchWithAuth(`${PATCH_URL}/field`, { method: 'POST' })).json(),
        })
        return { reorder, field }
      },
      { wrapper },
    )

    act(() => {
      result.current.reorder.mutate({ id: 'row-a' })
    })
    await settle()
    act(() => {
      result.current.field.mutate({ id: 'row-b', label: 'Beta-updated' })
    })
    await settle()
    await act(async () => {
      releaseReorder?.()
    })
    await settle()
    await act(async () => {
      releaseField?.()
    })
    await settle()

    const ids = queryClient
      .getQueryData<InfiniteData<ListPage>>(infiniteListKey)
      ?.pages.flatMap((page) => page.data.map((row) => row.id))
    expect(ids).toEqual(['row-a', 'row-b', 'row-c'])
    expect(listGetUrls).toHaveLength(0)
    expect(screen.getByRole('button', { name: 'Liste aktualisieren' })).toBeInTheDocument()
  })

  describe('explicit refresh while a mutation is pending', () => {
    const freshPage: ListPage = {
      data: [
        { id: 'row-x', label: 'Xray' },
        { id: 'row-y', label: 'Yankee' },
      ],
      meta: { next_cursor: 'cursor-fresh-2' },
    }
    const json = (body: unknown) => Promise.resolve({ ok: true, status: 200, json: async () => body } as Response)
    const noticeButton = () => screen.queryByRole('button', { name: 'Liste aktualisieren' })
    const idsOf = (queryClient: QueryClient) =>
      queryClient
        .getQueryData<InfiniteData<ListPage>>(infiniteListKey)
        ?.pages.flatMap((page) => page.data.map((row) => row.id))

    /** Writes (PATCH/POST) stay pending until the test answers them; reads return the fresh first page. */
    function holdWrites() {
      const held = new Map<string, { succeed: () => void; fail: () => void }>()
      vi.mocked(fetchWithAuth).mockImplementation((input, init) => {
        const url = String(input)
        if ((init?.method ?? 'GET') !== 'GET') {
          return new Promise<Response>((resolve, reject) => {
            held.set(url, { succeed: () => resolve({ ok: true, status: 200, json: async () => ({}) } as Response), fail: () => reject(new Error('rejected')) })
          })
        }
        if (url === COUNT_URL) {
          countGets += 1
          return json({ count: 2, isCapped: false })
        }
        listGetUrls.push(url)
        return json(freshPage)
      })
      return held
    }

    /** A field patch and a reorder (different mutation keys, so they run concurrently) on one infinite list. */
    function renderRaceHarness() {
      const queryClient = new QueryClient({
        defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
      })
      const wrapper = ({ children }: { children: ReactNode }) => (
        <QueryClientProvider client={queryClient}>
          {children}
          <InfiniteListRefreshNotice queryKey={infiniteListKey} />
        </QueryClientProvider>
      )
      const view = renderHook(
        () => {
          useInfiniteQuery({
            queryKey: infiniteListKey,
            meta: infiniteListQueryMeta(infiniteCountKey),
            initialPageParam: undefined as string | undefined,
            queryFn: async () => (await (await fetchWithAuth(LIST_URL)).json()) as ListPage,
            getNextPageParam: (lastPage) => lastPage.meta.next_cursor ?? undefined,
            staleTime: Infinity,
            initialData: seededInfinite(),
          })
          useQuery({
            queryKey: infiniteCountKey,
            queryFn: async () => (await (await fetchWithAuth(COUNT_URL)).json()) as { count: number; isCapped: boolean },
            staleTime: Infinity,
            initialData: { count: 3, isCapped: false },
          })
          const field = useMutation({
            ...optimisticMutationOptions<InfiniteData<ListPage>, { id: string; label: string; optimistic: boolean }>({
              queryKey: infiniteListKey,
              mutationKey: [...infiniteListKey, 'field'],
              shouldOptimistic: ({ optimistic }) => optimistic,
              entityId: ({ id }) => id,
              apply: (cache, { id, label }) => ({
                ...cache,
                pages: cache.pages.map((page) => ({
                  ...page,
                  data: page.data.map((row) => (row.id === id ? { ...row, label } : row)),
                })),
              }),
              revert: (_cache, _variables, snapshot) => snapshot,
            }),
            mutationFn: async () => (await fetchWithAuth(`${PATCH_URL}/field`, { method: 'PATCH' })).json(),
          })
          const reorder = useMutation({
            ...optimisticMutationOptions<InfiniteData<ListPage>, { id: string }>({
              queryKey: infiniteListKey,
              mutationKey: [...infiniteListKey, 'reorder'],
              entityId: ({ id }) => id,
              apply: (cache) => ({
                ...cache,
                pages: [{ ...cache.pages[0]!, data: [...cache.pages[0]!.data].reverse() }, ...cache.pages.slice(1)],
              }),
              revert: (_cache, _variables, snapshot) => snapshot,
            }),
            mutationFn: async () => (await fetchWithAuth(`${PATCH_URL}/reorder`, { method: 'POST' })).json(),
          })
          return { field, reorder }
        },
        { wrapper },
      )
      return { view, queryClient }
    }

    /** Multi-page list in the stale-preview state: an earlier reorder was reverted and marked the list stale. */
    async function reachStalePreview() {
      const held = holdWrites()
      const harness = renderRaceHarness()
      act(() => {
        harness.view.result.current.reorder.mutate({ id: 'row-a' })
      })
      await settle()
      await act(async () => {
        held.get(`${PATCH_URL}/reorder`)?.succeed()
      })
      await settle()
      expect(noticeButton()).toBeInTheDocument()
      expect(harness.queryClient.getQueryData<InfiniteData<ListPage>>(infiniteListKey)?.pages).toHaveLength(2)
      held.clear()
      listGetUrls.length = 0
      countGets = 0
      return { held, ...harness }
    }

    /** An optimistic patch resets `isInvalidated`, so only a non-optimistic mutation leaves the notice to click. */
    const refresh = (queryClient: QueryClient) =>
      act(async () => {
        const button = noticeButton()
        if (button) fireEvent.click(button)
        else await refreshInfiniteList(queryClient, infiniteListKey)
      })

    // Regression (CR7): settling a mutation that started before the refresh restored its old multi-page
    // snapshot and marked the list stale again, discarding the user's refresh.
    it.each([
      { change: 'optimistic patch', optimistic: true, answer: 'succeed' as const },
      { change: 'optimistic patch (rollback)', optimistic: true, answer: 'fail' as const },
      { change: 'non-optimistic change', optimistic: false, answer: 'succeed' as const },
      { change: 'non-optimistic change (failure)', optimistic: false, answer: 'fail' as const },
    ])('keeps the refreshed first page when an earlier $change settles after the refresh', async ({ optimistic, answer }) => {
      const { held, view, queryClient } = await reachStalePreview()

      act(() => {
        view.result.current.field.mutate({ id: 'row-b', label: 'Beta-updated', optimistic })
      })
      await settle()
      await refresh(queryClient)
      await waitFor(() => expect(idsOf(queryClient)).toEqual(['row-x', 'row-y']))
      expect(noticeButton()).not.toBeInTheDocument()

      await act(async () => {
        held.get(`${PATCH_URL}/field`)?.[answer]()
      })
      await settle()

      expect(idsOf(queryClient)).toEqual(['row-x', 'row-y'])
      expect(queryClient.getQueryData<InfiniteData<ListPage>>(infiniteListKey)?.pages).toHaveLength(1)
      expect(queryClient.getQueryCache().find({ queryKey: infiniteListKey, exact: true })?.state.isInvalidated).toBe(false)
      expect(noticeButton()).not.toBeInTheDocument()
      expect(listGetUrls).toEqual([LIST_URL])
    })

    // A mutation started after the refresh still reconciles normally; the older one settling last must not swallow that.
    it('still marks the refreshed list stale when a mutation started after the refresh changed membership', async () => {
      const { held, view, queryClient } = await reachStalePreview()

      act(() => {
        view.result.current.field.mutate({ id: 'row-b', label: 'Beta-updated', optimistic: true })
      })
      await settle()
      await refresh(queryClient)
      await waitFor(() => expect(idsOf(queryClient)).toEqual(['row-x', 'row-y']))
      act(() => {
        view.result.current.reorder.mutate({ id: 'row-x' })
      })
      await settle()
      expect(idsOf(queryClient)).toEqual(['row-y', 'row-x'])

      await act(async () => {
        held.get(`${PATCH_URL}/reorder`)?.succeed()
      })
      await settle()
      await act(async () => {
        held.get(`${PATCH_URL}/field`)?.succeed()
      })
      await settle()

      expect(idsOf(queryClient)).toEqual(['row-x', 'row-y'])
      expect(noticeButton()).toBeInTheDocument()
    })
  })

  it('drops the refresh notice when the query client is cleared', async () => {
    const { view, queryClient } = renderInfiniteMutationHarness({
      shouldOptimistic: () => false,
      apply: (cache) => cache,
    })
    await act(async () => {
      await view.result.current.mutation.mutateAsync({ id: 'row-a', label: 'ignored' })
    })
    expect(screen.getByRole('button', { name: 'Liste aktualisieren' })).toBeInTheDocument()

    act(() => {
      queryClient.clear()
    })

    await waitFor(() =>
      expect(screen.queryByRole('button', { name: 'Liste aktualisieren' })).not.toBeInTheDocument(),
    )
  })
})
