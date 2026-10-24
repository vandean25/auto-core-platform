import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useMutation, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import { boardKeys, useBoardActive, workshopKeys } from '@/api/workshop'
import type { BoardActiveResponse } from '@/api/workshop'
import { fetchWithAuth } from '@/api/client'
import { mechanicQueueKeys } from '@/api/mechanic'
import { RealtimeDashboardSyncProvider } from '@/features/realtime/RealtimeDashboardSyncProvider'
import { ENTITY_UPDATED_EVENT } from '@/features/realtime/types'
import { optimisticMutationOptions } from '@/lib/optimistic-mutation'
import { useWorkshopBoardAssignment } from '@/pages/workshop/useWorkshopBoardAssignment'
import { deWorkshop } from '@/test/de-workshop'

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
      assign: useWorkshopBoardAssignment('mechanic'),
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
    act(() => view.result.current.assign(orderId, { kind: 'mechanic', id: mechanicId, label: mechanicId }))
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
