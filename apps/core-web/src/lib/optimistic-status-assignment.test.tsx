import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider, useQuery } from '@tanstack/react-query'
import { act, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { toast } from 'sonner'
import {
  boardKeys,
  useBoardActive,
  useUpdateWorkshopTask,
  useUpdateWorkshopTaskChecklist,
  workshopKeys,
} from '@/api/workshop'
import type { BoardActiveResponse } from '@/api/workshop'
import type { WorkshopOrder, WorkshopTaskStatus } from '@/api/types'
import { fetchWithAuth } from '@/api/client'
import {
  mechanicQueueKeys,
  useMechanicQueue,
  useCompleteTask,
  useSaveDiagnostics,
  useStartTask,
  useSwitchTask,
  useUpdateMechanicTaskChecklist,
  type MechanicQueueResponse,
  type MechanicTaskDetail,
} from '@/api/mechanic'
import { getErrorMessage } from '@/lib/error-utils'
import { registerGermanUiForTests } from '@/test/german-ui'
import errorsDe from '../../../../locales/de/errors.json' with { type: 'json' }
import { RealtimeDashboardSyncProvider } from '@/features/realtime/RealtimeDashboardSyncProvider'
import { ENTITY_UPDATED_EVENT } from '@/features/realtime/types'
import { useWorkshopBoardAssignment } from '@/pages/workshop/useWorkshopBoardAssignment'

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

type Request = { url: string; method: string; body: unknown; respond: (status: number, body?: unknown) => void }

let requests: Request[]
let answered: Set<Request>

const BOARD_URL = '/api/workshop/board/active'
const ASSIGN_URL = '/api/workshop/board/assign'
const QUEUE_URL = '/api/mechanic/queue'
const START_URL = `/api/mechanic/tasks/task-1/start`
const TASK_PATCH_URL = '/api/workshop/orders/order-1/tasks/task-1'
const ORDER_DETAIL_URL = '/api/workshop/orders/order-1'
const COMPLETE_URL = '/api/mechanic/tasks/task-1/complete'

function pending(url: string, method = 'GET') {
  return requests.filter((request) => request.url === url && request.method === method)
}

function unanswered(url: string, method = 'GET') {
  return pending(url, method).filter((request) => !answered.has(request))
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

  it('clears rejected status after a queued notes save settles', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(workshopKeys.detail('order-1'), createOrder('IN_PROGRESS'))
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useUpdateWorkshopTask(), { wrapper })

    act(() => {
      void result.current
        .mutateAsync({ orderId: 'order-1', taskId: 'task-1', status: 'DONE' })
        .catch(() => undefined)
      void result.current.mutateAsync({
        orderId: 'order-1',
        taskId: 'task-1',
        mechanicNotes: 'Customer called back',
      })
    })
    await settle()
    expect(unanswered(TASK_PATCH_URL, 'PATCH')).toHaveLength(1)

    await respond(TASK_PATCH_URL, 'PATCH', 409, { message: 'conflict' })
    await waitFor(() => expect(unanswered(TASK_PATCH_URL, 'PATCH')).toHaveLength(1))

    const notesPatch = unanswered(TASK_PATCH_URL, 'PATCH').find(
      (request) => (request.body as { mechanicNotes?: string }).mechanicNotes !== undefined,
    )
    expect(notesPatch).toBeDefined()

    notesPatch!.respond(200, {
      ...createOrder('IN_PROGRESS'),
      tasks: [
        {
          ...createOrder('IN_PROGRESS').tasks![0],
          mechanicNotes: 'Customer called back',
        },
      ],
    })
    await settle()
    await waitFor(() =>
      expect(
        queryClient.getQueryData<WorkshopOrder>(workshopKeys.detail('order-1'))?.tasks?.[0]?.status,
      ).toBe('IN_PROGRESS'),
    )
    expect(
      queryClient.getQueryData<WorkshopOrder>(workshopKeys.detail('order-1'))?.tasks?.[0]?.mechanicNotes,
    ).toBe('Customer called back')
  })

  it('keeps the second optimistic status when the first task-status mutation settles', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const initialOrder = createOrder('IN_PROGRESS')
    queryClient.setQueryData(workshopKeys.detail('order-1'), initialOrder)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const view = renderHook(
      () => ({
        order: useQuery({
          queryKey: workshopKeys.detail('order-1'),
          queryFn: async () => {
            const response = await fetchWithAuth(ORDER_DETAIL_URL)
            if (!response.ok) throw new Error('failed')
            return response.json() as Promise<WorkshopOrder>
          },
          initialData: initialOrder,
          staleTime: Infinity,
        }),
        updateTask: useUpdateWorkshopTask(),
      }),
      { wrapper },
    )
    await waitFor(() => expect(view.result.current.order.data).toBeDefined())
    const detailGetsBeforeMutate = pending(ORDER_DETAIL_URL, 'GET').length

    act(() => {
      void view.result.current.updateTask.mutateAsync({
        orderId: 'order-1',
        taskId: 'task-1',
        status: 'DONE',
      })
      void view.result.current.updateTask.mutateAsync({
        orderId: 'order-1',
        taskId: 'task-1',
        status: 'WAITING_PARTS',
      })
    })
    await settle()

    await respond(TASK_PATCH_URL, 'PATCH', 200, createOrder('IN_PROGRESS'))
    await settle()

    expect(
      queryClient.getQueryData<WorkshopOrder>(workshopKeys.detail('order-1'))?.tasks?.[0]?.status,
    ).toBe('WAITING_PARTS')
    expect(pending(ORDER_DETAIL_URL, 'GET')).toHaveLength(detailGetsBeforeMutate)

    await respond(TASK_PATCH_URL, 'PATCH', 200, createOrder('WAITING_PARTS'))
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
        complete: useCompleteTask(),
        switchTask: useSwitchTask(),
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

  it('keeps DONE when start fails while complete is queued on the shared lifecycle key', async () => {
    const { view, queryClient } = await setupQueue()
    act(() => {
      void view.result.current.start.mutateAsync({ taskId: 'task-1' }).catch(() => undefined)
      void view.result.current.complete.mutateAsync({ taskId: 'task-1' })
    })
    await settle()
    await respond(START_URL, 'POST', 403, { message: 'rejected' })
    await waitFor(() =>
      expect(
        queryClient.getQueryData<MechanicQueueResponse>(mechanicQueueKeys.queue())?.data[0]?.taskStatus,
      ).toBe('DONE'),
    )
    await respond(COMPLETE_URL, 'POST', 200, { taskId: 'task-1', taskStatus: 'DONE' })
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

  it('routes useSwitchTask through the shared lifecycle optimistic helper', async () => {
    const { view, queryClient } = await setupQueue()
    act(() => {
      void view.result.current.switchTask.mutateAsync({
        taskId: 'task-1',
        payload: { previousPauseReason: 'SWITCHED_TO_HIGHER_PRIORITY' },
      })
    })
    await settle()
    expect(
      queryClient.getQueryData<MechanicQueueResponse>(mechanicQueueKeys.queue())?.data[0]?.taskStatus,
    ).toBe('IN_PROGRESS')

    await respond('/api/mechanic/tasks/task-1/switch', 'POST', 200, {
      taskId: 'task-1',
      taskStatus: 'IN_PROGRESS',
    })
    await waitFor(() => expect(pending(QUEUE_URL).length).toBeGreaterThan(1))
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

  function renderAssignAndTask(initialOrder: WorkshopOrder) {
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
        order: useQuery({
          queryKey: workshopKeys.detail('order-1'),
          queryFn: async () => {
            const response = await fetchWithAuth(ORDER_DETAIL_URL)
            if (!response.ok) throw new Error('failed')
            return response.json() as Promise<WorkshopOrder>
          },
          initialData: initialOrder,
          staleTime: Infinity,
        }),
        board: useBoardActive(),
        boardAssignment: useWorkshopBoardAssignment('mechanic'),
        updateTask: useUpdateWorkshopTask(),
      }),
      { wrapper },
    )
    return { queryClient, view }
  }

  // Planner/bay moves are server-confirmed: the board cache is never patched, and the move is reported as pending.
  it('(f) leaves the board as it was while the move is pending and does not refetch the detail over a pending task status', async () => {
    const { queryClient, view } = renderAssignAndTask(createOrder('IN_PROGRESS'))
    await waitFor(() => expect(mocks.socket.on).toHaveBeenCalled())
    await respond(BOARD_URL, 'GET', 200, {
      data: [{ id: 'order-1', mechanicId: null, bayId: null }],
    } as BoardActiveResponse)
    await waitFor(() => expect(view.result.current.board.data).toBeDefined())

    act(() => {
      void view.result.current.updateTask.mutateAsync({ orderId: 'order-1', taskId: 'task-1', status: 'DONE' })
    })
    await settle()
    act(() =>
      view.result.current.boardAssignment.assign('order-1', { kind: 'mechanic', id: 'mech-2', label: 'mech-2' }),
    )
    await settle()

    expect(queryClient.getQueryData<BoardActiveResponse>(boardKeys.active())?.data[0]?.mechanicId).toBeNull()
    expect(view.result.current.boardAssignment.pendingMoves.get('order-1')).toBe('mech-2')
    expect(queryClient.getQueryData<WorkshopOrder>(workshopKeys.detail('order-1'))?.tasks?.[0]?.status).toBe('DONE')

    const detailGets = pending(ORDER_DETAIL_URL, 'GET').length
    await respond(ASSIGN_URL, 'PATCH', 200, {})
    await waitFor(() => expect(pending(BOARD_URL).length).toBeGreaterThan(1))
    expect(view.result.current.boardAssignment.pendingMoves.size).toBe(0)
    expect(pending(ORDER_DETAIL_URL, 'GET')).toHaveLength(detailGets)
    expect(queryClient.getQueryData<WorkshopOrder>(workshopKeys.detail('order-1'))?.tasks?.[0]?.status).toBe('DONE')

    await respond(TASK_PATCH_URL, 'PATCH', 200, createOrder('DONE'))
  })

  // The guard is per order: a task patch on another order must not hold back this order's detail refetch.
  it('refetches the assigned order detail while a task-status patch of another order is pending', async () => {
    const { view } = renderAssignAndTask(createOrder('IN_PROGRESS'))
    await waitFor(() => expect(mocks.socket.on).toHaveBeenCalled())
    await respond(BOARD_URL, 'GET', 200, {
      data: [{ id: 'order-1', mechanicId: null, bayId: null }],
    } as BoardActiveResponse)
    await waitFor(() => expect(view.result.current.board.data).toBeDefined())

    act(() => {
      void view.result.current.updateTask.mutateAsync({ orderId: 'order-2', taskId: 'task-9', status: 'DONE' })
    })
    act(() =>
      view.result.current.boardAssignment.assign('order-1', { kind: 'mechanic', id: 'mech-2', label: 'mech-2' }),
    )
    await settle()
    const detailGets = pending(ORDER_DETAIL_URL, 'GET').length

    await respond(ASSIGN_URL, 'PATCH', 200, {})

    await waitFor(() => expect(pending(ORDER_DETAIL_URL, 'GET').length).toBeGreaterThan(detailGets))
  })

  // Scenario 3 for the move: nothing was patched, so a 403 only clears pending and shows the permission message.
  it('a 403 on the move keeps the order detail and the optimistic task status and shows the permission message', async () => {
    const { queryClient, view } = renderAssignAndTask({
      ...createOrder('DONE'),
      mechanicId: 'mech-1',
      mechanic_id: 'mech-1',
    })
    await waitFor(() => expect(mocks.socket.on).toHaveBeenCalled())
    await respond(BOARD_URL, 'GET', 200, {
      data: [{ id: 'order-1', mechanicId: 'mech-1', bayId: null }],
    } as BoardActiveResponse)
    await waitFor(() => expect(view.result.current.board.data).toBeDefined())

    act(() =>
      view.result.current.boardAssignment.assign('order-1', { kind: 'mechanic', id: 'mech-2', label: 'mech-2' }),
    )
    await settle()
    act(() => {
      void view.result.current.updateTask.mutateAsync({ orderId: 'order-1', taskId: 'task-1', status: 'DONE' })
    })
    await settle()
    expect(queryClient.getQueryData<WorkshopOrder>(workshopKeys.detail('order-1'))?.mechanicId).toBe('mech-1')

    await respond(ASSIGN_URL, 'PATCH', 403, { message: 'forbidden' })
    await waitFor(() => expect(toast.error).toHaveBeenCalledWith(errorsDe.codes.HTTP_403))

    expect(view.result.current.boardAssignment.pendingMoves.size).toBe(0)
    expect(queryClient.getQueryData<WorkshopOrder>(workshopKeys.detail('order-1'))?.mechanicId).toBe('mech-1')
    expect(queryClient.getQueryData<WorkshopOrder>(workshopKeys.detail('order-1'))?.tasks?.[0]?.status).toBe('DONE')
  })
})

describe('workshop task notes merge', () => {
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

  it('merges mechanicNotes onto the cached order without replacing optimistic task status', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(workshopKeys.detail('order-1'), createOrder('DONE'))
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const { result } = renderHook(() => useUpdateWorkshopTask(), { wrapper })

    act(() => {
      void result.current.mutateAsync({
        orderId: 'order-1',
        taskId: 'task-1',
        mechanicNotes: 'Check pads again',
      })
    })
    await settle()
    await respond(TASK_PATCH_URL, 'PATCH', 200, createOrder('IN_PROGRESS'))

    await waitFor(() =>
      expect(
        queryClient.getQueryData<WorkshopOrder>(workshopKeys.detail('order-1'))?.tasks?.[0]?.status,
      ).toBe('DONE'),
    )
    expect(
      queryClient.getQueryData<WorkshopOrder>(workshopKeys.detail('order-1'))?.tasks?.[0]?.mechanicNotes,
    ).toBe('Check pads again')
  })
})


// AUT-882: field edits on work-order and mechanic-queue caches are optimistic (ADR-0036 R1).
const CHECKLIST_PATCH_URL = '/api/workshop/orders/order-1/tasks/task-1/checklist'
const MECHANIC_CHECKLIST_URL = '/api/mechanic/tasks/task-1/checklist'
const DIAGNOSTICS_URL = '/api/mechanic/tasks/task-1/diagnostics'

const checklistSeed = {
  id: 'inspection-1',
  title: 'Pickerl',
  items: [{ id: 'item-1', label_snapshot: 'Beleuchtung', passed: null, notes: null }],
}
const taskDetailSeed = {
  taskId: 'task-1',
  taskStatus: 'IN_PROGRESS',
  mechanicNotes: 'before',
} as MechanicTaskDetail

function useWorkshopChecklistEdit() {
  const { mutateAsync } = useUpdateWorkshopTaskChecklist()
  return () =>
    mutateAsync({ orderId: 'order-1', taskId: 'task-1', items: [{ id: 'item-1', passed: true }] })
}

function useMechanicChecklistEdit() {
  const { mutateAsync } = useUpdateMechanicTaskChecklist()
  return () => mutateAsync({ taskId: 'task-1', items: [{ id: 'item-1', passed: true }] })
}

function useDiagnosticsEdit() {
  const { mutateAsync } = useSaveDiagnostics()
  return () => mutateAsync({ taskId: 'task-1', payload: { mechanicNotes: 'after' } })
}

type FieldEdit = {
  name: string
  url: string
  queryKey: readonly unknown[]
  seed: unknown
  useEdit: () => () => Promise<unknown>
  read: (cache: unknown) => unknown
  before: unknown
  after: unknown
}

const fieldEdits: FieldEdit[] = [
  {
    name: 'workshop checklist item',
    url: CHECKLIST_PATCH_URL,
    queryKey: workshopKeys.taskChecklist('order-1', 'task-1'),
    seed: checklistSeed,
    useEdit: useWorkshopChecklistEdit,
    read: (cache) => (cache as typeof checklistSeed).items[0]?.passed,
    before: null,
    after: true,
  },
  {
    name: 'mechanic checklist item',
    url: MECHANIC_CHECKLIST_URL,
    queryKey: mechanicQueueKeys.taskChecklist('task-1'),
    seed: checklistSeed,
    useEdit: useMechanicChecklistEdit,
    read: (cache) => (cache as typeof checklistSeed).items[0]?.passed,
    before: null,
    after: true,
  },
  {
    name: 'mechanic diagnostics notes',
    url: DIAGNOSTICS_URL,
    queryKey: mechanicQueueKeys.taskDetail('task-1'),
    seed: taskDetailSeed,
    useEdit: useDiagnosticsEdit,
    read: (cache) => (cache as MechanicTaskDetail).mechanicNotes,
    before: 'before',
    after: 'after',
  },
]

describe('AUT-882 optimistic field edits', () => {
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

  function setupEdit(edit: FieldEdit) {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(edit.queryKey, edit.seed)
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const view = renderHook(edit.useEdit, { wrapper })
    const read = () => edit.read(queryClient.getQueryData(edit.queryKey))
    return { view, read }
  }

  // Scenario 1: the cache holds the new value while the PATCH is still unanswered.
  it.each(fieldEdits)('shows the edited $name before the server responds', async (edit) => {
    const { view, read } = setupEdit(edit)

    act(() => {
      void view.result.current()
    })
    await settle()

    expect(unanswered(edit.url, 'PATCH')).toHaveLength(1)
    expect(read()).toBe(edit.after)
  })

  // Scenario 2: a definite rejection puts the previous value back and the caller can raise the error marker.
  it.each(fieldEdits)('restores the previous $name when the server rejects the edit', async (edit) => {
    const { view, read } = setupEdit(edit)

    let rejection: unknown
    act(() => {
      void view.result.current().catch((error: unknown) => {
        rejection = error
      })
    })
    await settle()
    expect(read()).toBe(edit.after)

    await respond(edit.url, 'PATCH', 422, { message: 'rejected' })

    await waitFor(() => expect(read()).toBe(edit.before))
    expect(rejection).toBeInstanceOf(Error)
  })

  // Scenario 3: the same rollback on 403, with the error carrying the status the permission message is built from.
  it.each(fieldEdits)('rolls back the $name on 403 and maps it to the permission message', async (edit) => {
    const { view, read } = setupEdit(edit)

    let rejection: unknown
    act(() => {
      void view.result.current().catch((error: unknown) => {
        rejection = error
      })
    })
    await settle()
    expect(read()).toBe(edit.after)
    await respond(edit.url, 'PATCH', 403, { message: 'Forbidden resource' })

    await waitFor(() => expect(read()).toBe(edit.before))
    expect(getErrorMessage(rejection, 'fallback')).toBe(errorsDe.codes.HTTP_403)
  })

  // ADR-0036 acceptance: a rolled-back lifecycle change must not take a newer notes edit of the same record with it.
  it('keeps pending diagnostics notes when a task lifecycle change on the same detail fails', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    const detailKey = mechanicQueueKeys.taskDetail('task-1')
    queryClient.setQueryData(detailKey, { ...taskDetailSeed, taskStatus: 'NOT_STARTED' })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const view = renderHook(() => ({ start: useStartTask(), save: useDiagnosticsEdit() }), { wrapper })

    act(() => {
      void view.result.current.start.mutateAsync({ taskId: 'task-1' }).catch(() => undefined)
      void view.result.current.save()
    })
    await settle()
    await respond(START_URL, 'POST', 403, { message: 'rejected' })

    await waitFor(() =>
      expect(queryClient.getQueryData<MechanicTaskDetail>(detailKey)?.taskStatus).toBe('NOT_STARTED'),
    )
    expect(queryClient.getQueryData<MechanicTaskDetail>(detailKey)?.mechanicNotes).toBe('after')
  })

  // Scenario 1 for the mechanic queue: list row and detail change together before the server answers.
  it('moves the queue row and the task detail together before the start request is answered', async () => {
    const queryClient = new QueryClient({
      defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
    })
    queryClient.setQueryData(mechanicQueueKeys.queue(), createQueue('NOT_STARTED'))
    queryClient.setQueryData(mechanicQueueKeys.taskDetail('task-1'), { ...taskDetailSeed, taskStatus: 'NOT_STARTED' })
    const wrapper = ({ children }: { children: ReactNode }) => (
      <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
    )
    const view = renderHook(() => useStartTask(), { wrapper })

    act(() => {
      void view.result.current.mutateAsync({ taskId: 'task-1' })
    })
    await settle()

    expect(unanswered(START_URL, 'POST')).toHaveLength(1)
    expect(queryClient.getQueryData<MechanicQueueResponse>(mechanicQueueKeys.queue())?.data[0]?.taskStatus).toBe(
      'IN_PROGRESS',
    )
    expect(queryClient.getQueryData<MechanicTaskDetail>(mechanicQueueKeys.taskDetail('task-1'))?.taskStatus).toBe(
      'IN_PROGRESS',
    )
  })
})
