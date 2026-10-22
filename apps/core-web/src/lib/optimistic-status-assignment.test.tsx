import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import {
  boardKeys,
  useBoardActive,
  useUpdateWorkshopTask,
  workshopKeys,
} from '@/api/workshop'
import type { BoardActiveResponse } from '@/api/workshop'
import type { WorkshopOrder, WorkshopTaskStatus } from '@/api/types'
import { fetchWithAuth } from '@/api/client'
import {
  mechanicQueueKeys,
  useMechanicQueue,
  useStartTask,
  type MechanicQueueResponse,
} from '@/api/mechanic'
import { RealtimeDashboardSyncProvider } from '@/features/realtime/RealtimeDashboardSyncProvider'
import { ENTITY_UPDATED_EVENT } from '@/features/realtime/types'
import { useWorkshopBoardAssignment } from '@/pages/workshop/useWorkshopBoardAssignment'

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

type Request = { url: string; method: string; body: unknown; respond: (status: number, body?: unknown) => void }

let requests: Request[]
let answered: Set<Request>

const BOARD_URL = '/api/workshop/board/active'
const ASSIGN_URL = '/api/workshop/board/assign'
const QUEUE_URL = '/api/mechanic/queue'
const START_URL = `/api/mechanic/tasks/task-1/start`
const TASK_PATCH_URL = '/api/workshop/orders/order-1/tasks/task-1'

function pending(url: string, method = 'GET') {
  return requests.filter((request) => request.url === url && request.method === method)
}

function nextRequest(url: string, method = 'GET'): Request {
  const request = pending(url, method).filter((candidate) => !answered.has(candidate)).at(-1)
  if (!request) throw new Error(`no pending ${method} ${url}`)
  answered.add(request)
  return request
}

const settle = () =>
  act(async () => {
    await new Promise((resolve) => setTimeout(resolve, 0))
  })

async function respond(url: string, method: string, status: number, body: unknown) {
  nextRequest(url, method).respond(status, body)
  await settle()
}

function emit(type: 'WORKSHOP_ORDER' | 'WORKSHOP_TASK') {
  const handler = mocks.socket.on.mock.calls.filter(([event]) => event === ENTITY_UPDATED_EVENT).at(-1)?.[1] as
    | ((payload: unknown) => void)
    | undefined
  act(() => handler?.({ type, action: 'UPDATED', entityId: 'order-1', timestamp: '2026-05-01T10:00:00.000Z' }))
}

function createOrder(taskStatus: WorkshopTaskStatus = 'IN_PROGRESS'): WorkshopOrder {
  return {
    id: 'order-1',
    order_number: 'WO-1',
    status: 'IN_PROGRESS',
    purpose: 'CUSTOMER_REPAIR',
    customer_id: 'c1',
    customer: { id: 'c1', type: 'PRIVATE', first_name: 'A', last_name: 'B', email: null },
    vehicle_id: 'v1',
    vehicle: { id: 'v1', make: 'Audi', model: 'A4', year: 2024 },
    odometer: 1,
    fuel_level: 0.5,
    createdAt: '2026-01-01T00:00:00.000Z',
    tasks: [
      {
        id: 'task-1',
        title: 'Brakes',
        lineItemsVersion: 0,
        status: taskStatus,
        done: taskStatus === 'DONE',
        lineItems: [],
      },
    ],
  }
}

function createQueue(taskStatus: MechanicQueueResponse['data'][number]['taskStatus']): MechanicQueueResponse {
  return {
    data: [
      {
        taskId: 'task-1',
        taskTitle: 'Brakes',
        taskStatus,
        orderId: 'order-1',
        orderNumber: 'WO-1',
        reportedComplaint: null,
        vehicle: { id: 'v1', make: 'Audi', model: 'A4', year: 2024, plate: 'W-1' },
        bay: null,
        sequence: 1,
        scheduledDate: null,
        partLines: [],
        updatedAt: '2026-05-01T10:00:00.000Z',
      },
    ],
  }
}

describe('optimistic workshop task status vs realtime echo', () => {
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

  it('updates task status in the order cache immediately', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(workshopKeys.detail('order-1'), createOrder('NOT_STARTED'))
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useUpdateWorkshopTask(), { wrapper })

    act(() => {
      void result.current.mutateAsync({
        orderId: 'order-1',
        taskId: 'task-1',
        status: 'DONE',
      })
    })
    await settle()

    const order = queryClient.getQueryData<WorkshopOrder>(workshopKeys.detail('order-1'))
    expect(order?.tasks?.[0]?.status).toBe('DONE')
  })

  it.each([403, 409])('rolls back task status and surfaces toast on %i', async (status) => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(workshopKeys.detail('order-1'), createOrder('IN_PROGRESS'))
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <RealtimeDashboardSyncProvider>{children}</RealtimeDashboardSyncProvider>
      </QueryClientProvider>
    )
    const { result } = renderHook(() => useUpdateWorkshopTask(), { wrapper })
    await waitFor(() => expect(mocks.socket.on).toHaveBeenCalled())

    act(() => {
      void result.current.mutateAsync({
        orderId: 'order-1',
        taskId: 'task-1',
        status: 'DONE',
      }).catch(() => toast.error('failed'))
    })
    await settle()
    await respond(TASK_PATCH_URL, 'PATCH', status, { message: 'rejected' })
    await waitFor(() =>
      expect(
        queryClient.getQueryData<WorkshopOrder>(workshopKeys.detail('order-1'))?.tasks?.[0]?.status,
      ).toBe('IN_PROGRESS'),
    )
  })
})

describe('optimistic mechanic queue lifecycle vs realtime echo', () => {
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

  async function setupQueue() {
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
        queue: useMechanicQueue(),
        start: useStartTask(),
      }),
      { wrapper },
    )
    await waitFor(() => expect(mocks.socket.on).toHaveBeenCalled())
    await respond(QUEUE_URL, 'GET', 200, createQueue('NOT_STARTED'))
    await waitFor(() => expect(view.result.current.queue.data).toBeDefined())
    return { view, queryClient }
  }

  it('(a) defers queue echo until start settles', async () => {
    const { view, queryClient } = await setupQueue()
    act(() => {
      void view.result.current.start.mutateAsync({ taskId: 'task-1' })
    })
    await settle()
    emit('WORKSHOP_TASK')
    await settle()
    expect(pending(QUEUE_URL)).toHaveLength(1)
    expect(
      queryClient.getQueryData<MechanicQueueResponse>(mechanicQueueKeys.queue())?.data[0]?.taskStatus,
    ).toBe('IN_PROGRESS')

    await respond(START_URL, 'POST', 200, { taskId: 'task-1', taskStatus: 'IN_PROGRESS' })
    await waitFor(() => expect(pending(QUEUE_URL).length).toBeGreaterThan(1))
  })

  it('(c) two quick starts end on the last intent', async () => {
    const { view, queryClient } = await setupQueue()
    act(() => {
      void view.result.current.start.mutateAsync({ taskId: 'task-1' })
      void view.result.current.start.mutateAsync({ taskId: 'task-1' })
    })
    await settle()
    expect(
      queryClient.getQueryData<MechanicQueueResponse>(mechanicQueueKeys.queue())?.data[0]?.taskStatus,
    ).toBe('IN_PROGRESS')
  })
})

describe('concurrent board assign and workshop task status', () => {
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

  it('(f) does not refetch the board over a pending task-status mutation', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(workshopKeys.detail('order-1'), createOrder('IN_PROGRESS'))
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>
        <RealtimeDashboardSyncProvider>{children}</RealtimeDashboardSyncProvider>
      </QueryClientProvider>
    )
    const view = renderHook(
      () => ({
        board: useBoardActive(),
        assign: useWorkshopBoardAssignment('mechanic'),
        updateTask: useUpdateWorkshopTask(),
      }),
      { wrapper },
    )
    await waitFor(() => expect(mocks.socket.on).toHaveBeenCalled())
    await respond(BOARD_URL, 'GET', 200, {
      data: [{ id: 'order-1', mechanicId: null, bayId: null }],
    } as BoardActiveResponse)
    await waitFor(() => expect(view.result.current.board.data).toBeDefined())

    act(() => {
      void view.result.current.updateTask.mutateAsync({
        orderId: 'order-1',
        taskId: 'task-1',
        status: 'DONE',
      })
    })
    await settle()

    act(() => view.result.current.assign('order-1', { kind: 'mechanic', id: 'mech-2', label: 'mech-2' }))
    await settle()

    expect(pending(BOARD_URL)).toHaveLength(1)
    expect(
      queryClient.getQueryData<BoardActiveResponse>(boardKeys.active())?.data[0]?.mechanicId,
    ).toBe('mech-2')
    expect(queryClient.getQueryData<WorkshopOrder>(workshopKeys.detail('order-1'))?.tasks?.[0]?.status).toBe(
      'DONE',
    )

    await respond(ASSIGN_URL, 'PATCH', 200, {})
    await waitFor(() => expect(pending(BOARD_URL).length).toBeGreaterThan(1))
    await respond(TASK_PATCH_URL, 'PATCH', 200, createOrder('DONE'))
  })
})
