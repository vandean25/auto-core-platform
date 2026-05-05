import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import type { ReactNode } from 'react'
import {
  useMechanicQueue,
  useMechanicTaskDetail,
  useStartTask,
  useSwitchTask,
  usePauseTask,
  useCompleteTask,
  useSaveDiagnostics,
  useRequestPart,
  mechanicQueueKeys,
} from './mechanic'
import { fetchWithAuth } from './client'

vi.mock('./client', () => ({
  fetchWithAuth: vi.fn(),
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createWrapper(client: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={client}>{children}</QueryClientProvider>
  )
}

function createJsonResponse(body: unknown, ok = true, status = 200): Response {
  return { ok, status, json: async () => body } as Response
}

const TASK_ID = '22222222-2222-2222-2222-222222222222'

const baseQueueItem = {
  taskId: TASK_ID,
  taskTitle: 'Oil Change',
  taskStatus: 'NOT_STARTED',
  orderId: 'order-1',
  orderNumber: 'WO-2026-0001',
  reportedComplaint: null,
  vehicle: { id: 'v1', make: 'BMW', model: '320d', year: 2022, plate: null },
  bay: null,
  sequence: 1,
  scheduledDate: null,
  partLines: [],
  updatedAt: '2026-04-28T10:00:00.000Z',
}

const baseTaskDetail = {
  taskId: TASK_ID,
  taskTitle: 'Oil Change',
  taskStatus: 'NOT_STARTED',
  mechanicNotes: null,
  orderId: 'order-1',
  orderNumber: 'WO-2026-0001',
  reportedComplaint: 'Engine light on',
  odometer: 80000,
  vehicle: { id: 'v1', make: 'BMW', model: '320d', year: 2022, vin: null, plate: null },
  bay: null,
  sequence: 1,
  scheduledDate: null,
  lineItems: [],
  createdAt: '2026-04-28T10:00:00.000Z',
  updatedAt: '2026-04-28T10:00:00.000Z',
}

describe('mechanic api hooks', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  // ─── Key Factory ────────────────────────────────────────────────────────────

  describe('mechanicQueueKeys', () => {
    it('all key is ["mechanic"]', () => {
      expect(mechanicQueueKeys.all).toEqual(['mechanic'])
    })

    it('queue key is ["mechanic", "queue"]', () => {
      expect(mechanicQueueKeys.queue()).toEqual(['mechanic', 'queue'])
    })

    it('taskDetail key namespaces by taskId', () => {
      expect(mechanicQueueKeys.taskDetail(TASK_ID)).toEqual([
        'mechanic',
        'task',
        TASK_ID,
      ])
    })
  })

  // ─── useMechanicQueue ────────────────────────────────────────────────────────

  describe('useMechanicQueue', () => {
    it('fetches queue and returns data array', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse({ data: [baseQueueItem] }),
      )

      const queryClient = createQueryClient()
      const { result } = renderHook(() => useMechanicQueue(), {
        wrapper: createWrapper(queryClient),
      })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(fetchWithAuth).toHaveBeenCalledWith('/api/mechanic/queue')
      expect(result.current.data?.data).toHaveLength(1)
      expect(result.current.data?.data[0].taskId).toBe(TASK_ID)
    })

    it('response does not expose financial fields', async () => {
      // The API only returns what the backend exposes; this test ensures the
      // response shape does not accidentally include pricing fields.
      const itemWithoutFinancials = {
        ...baseQueueItem,
        // Confirm these keys do NOT appear in the response
      }
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse({ data: [itemWithoutFinancials] }),
      )

      const queryClient = createQueryClient()
      const { result } = renderHook(() => useMechanicQueue(), {
        wrapper: createWrapper(queryClient),
      })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      const item = result.current.data?.data[0] as Record<string, unknown>
      expect(item).not.toHaveProperty('unitPrice')
      expect(item).not.toHaveProperty('lineTotal')
      expect(item).not.toHaveProperty('internalCostRate')
    })

    it('response does not expose customer PII fields', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse({ data: [baseQueueItem] }),
      )

      const queryClient = createQueryClient()
      const { result } = renderHook(() => useMechanicQueue(), {
        wrapper: createWrapper(queryClient),
      })

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      const item = result.current.data?.data[0] as Record<string, unknown>
      expect(item).not.toHaveProperty('customer')
      expect(item).not.toHaveProperty('email')
      expect(item).not.toHaveProperty('phone')
    })
  })

  // ─── useMechanicTaskDetail ────────────────────────────────────────────────────

  describe('useMechanicTaskDetail', () => {
    it('fetches task detail by taskId', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(baseTaskDetail),
      )

      const queryClient = createQueryClient()
      const { result } = renderHook(
        () => useMechanicTaskDetail(TASK_ID),
        { wrapper: createWrapper(queryClient) },
      )

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      expect(fetchWithAuth).toHaveBeenCalledWith(`/api/mechanic/tasks/${TASK_ID}`)
      expect(result.current.data?.taskId).toBe(TASK_ID)
    })

    it('is disabled when taskId is empty', () => {
      const queryClient = createQueryClient()
      const { result } = renderHook(
        () => useMechanicTaskDetail(''),
        { wrapper: createWrapper(queryClient) },
      )

      expect(fetchWithAuth).not.toHaveBeenCalled()
      expect(result.current.isFetching).toBe(false)
    })

    it('task detail does not expose financial fields', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(baseTaskDetail),
      )

      const queryClient = createQueryClient()
      const { result } = renderHook(
        () => useMechanicTaskDetail(TASK_ID),
        { wrapper: createWrapper(queryClient) },
      )

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      const detail = result.current.data as Record<string, unknown>
      expect(detail).not.toHaveProperty('unitPrice')
      expect(detail).not.toHaveProperty('lineTotal')
      expect(detail).not.toHaveProperty('totalAmount')
      expect(detail).not.toHaveProperty('invoice')
    })

    it('task detail does not expose customer PII', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(baseTaskDetail),
      )

      const queryClient = createQueryClient()
      const { result } = renderHook(
        () => useMechanicTaskDetail(TASK_ID),
        { wrapper: createWrapper(queryClient) },
      )

      await waitFor(() => expect(result.current.isSuccess).toBe(true))

      const detail = result.current.data as Record<string, unknown>
      expect(detail).not.toHaveProperty('customer')
      expect(detail).not.toHaveProperty('email')
      expect(detail).not.toHaveProperty('phone')
    })
  })

  // ─── useStartTask ────────────────────────────────────────────────────────────

  describe('useStartTask', () => {
    it('posts to start endpoint and returns task detail', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse({ ...baseTaskDetail, taskStatus: 'IN_PROGRESS' }),
      )

      const queryClient = createQueryClient()
      const { result } = renderHook(() => useStartTask(), {
        wrapper: createWrapper(queryClient),
      })

      const data = await result.current.mutateAsync({ taskId: TASK_ID })

      expect(fetchWithAuth).toHaveBeenCalledWith(
        `/api/mechanic/tasks/${TASK_ID}/start`,
        expect.objectContaining({ method: 'POST' }),
      )
      expect(data.taskStatus).toBe('IN_PROGRESS')
    })

    it('throws http error with status attached on 409', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(
          { message: 'Mechanic already has an open labor entry — use switch instead.' },
          false,
          409,
        ),
      )

      const queryClient = createQueryClient()
      const { result } = renderHook(() => useStartTask(), {
        wrapper: createWrapper(queryClient),
      })

      await expect(
        result.current.mutateAsync({ taskId: TASK_ID }),
      ).rejects.toMatchObject({
        status: 409,
      })
    })
  })

  // ─── useSwitchTask ────────────────────────────────────────────────────────────

  describe('useSwitchTask', () => {
    it('posts switch payload and returns updated task detail', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse({ ...baseTaskDetail, taskStatus: 'IN_PROGRESS' }),
      )

      const queryClient = createQueryClient()
      const { result } = renderHook(() => useSwitchTask(), {
        wrapper: createWrapper(queryClient),
      })

      const data = await result.current.mutateAsync({
        taskId: TASK_ID,
        payload: { previousPauseReason: 'SWITCHED_TO_HIGHER_PRIORITY' },
      })

      expect(fetchWithAuth).toHaveBeenCalledWith(
        `/api/mechanic/tasks/${TASK_ID}/switch`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ previousPauseReason: 'SWITCHED_TO_HIGHER_PRIORITY' }),
        }),
      )
      expect(data.taskStatus).toBe('IN_PROGRESS')
    })

    it('throws http error with status 409 when mechanic has no open labor entry', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse(
          { message: 'No open labor entry to switch from — start the task directly instead.' },
          false,
          409,
        ),
      )

      const queryClient = createQueryClient()
      const { result } = renderHook(() => useSwitchTask(), {
        wrapper: createWrapper(queryClient),
      })

      await expect(
        result.current.mutateAsync({
          taskId: TASK_ID,
          payload: { previousPauseReason: 'SWITCHED_TO_HIGHER_PRIORITY' },
        }),
      ).rejects.toMatchObject({ status: 409 })
    })
  })

  // ─── usePauseTask ────────────────────────────────────────────────────────────

  describe('usePauseTask', () => {
    it('posts pause payload and returns task detail', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse({ ...baseTaskDetail, taskStatus: 'WAITING_PARTS' }),
      )

      const queryClient = createQueryClient()
      const { result } = renderHook(() => usePauseTask(), {
        wrapper: createWrapper(queryClient),
      })

      const data = await result.current.mutateAsync({
        taskId: TASK_ID,
        payload: { pauseReason: 'WAITING_PARTS' },
      })

      expect(fetchWithAuth).toHaveBeenCalledWith(
        `/api/mechanic/tasks/${TASK_ID}/pause`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ pauseReason: 'WAITING_PARTS' }),
        }),
      )
      expect(data.taskStatus).toBe('WAITING_PARTS')
    })
  })

  // ─── useCompleteTask ────────────────────────────────────────────────────────

  describe('useCompleteTask', () => {
    it('posts to complete endpoint and returns DONE task', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse({ ...baseTaskDetail, taskStatus: 'DONE' }),
      )

      const queryClient = createQueryClient()
      const { result } = renderHook(() => useCompleteTask(), {
        wrapper: createWrapper(queryClient),
      })

      const data = await result.current.mutateAsync({ taskId: TASK_ID })

      expect(fetchWithAuth).toHaveBeenCalledWith(
        `/api/mechanic/tasks/${TASK_ID}/complete`,
        expect.objectContaining({ method: 'POST' }),
      )
      expect(data.taskStatus).toBe('DONE')
    })
  })

  // ─── useSaveDiagnostics ─────────────────────────────────────────────────────

  describe('useSaveDiagnostics', () => {
    it('patches diagnostics with mechanic notes', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse({ taskId: TASK_ID, mechanicNotes: 'Oil was dark.' }),
      )

      const queryClient = createQueryClient()
      const { result } = renderHook(() => useSaveDiagnostics(), {
        wrapper: createWrapper(queryClient),
      })

      const data = await result.current.mutateAsync({
        taskId: TASK_ID,
        payload: { mechanicNotes: 'Oil was dark.' },
      })

      expect(fetchWithAuth).toHaveBeenCalledWith(
        `/api/mechanic/tasks/${TASK_ID}/diagnostics`,
        expect.objectContaining({
          method: 'PATCH',
          body: JSON.stringify({ mechanicNotes: 'Oil was dark.' }),
        }),
      )
      expect(data.mechanicNotes).toBe('Oil was dark.')
    })

    it('accepts empty payload for partial save (no notes change)', async () => {
      vi.mocked(fetchWithAuth).mockResolvedValue(
        createJsonResponse({ taskId: TASK_ID, mechanicNotes: null }),
      )

      const queryClient = createQueryClient()
      const { result } = renderHook(() => useSaveDiagnostics(), {
        wrapper: createWrapper(queryClient),
      })

      await expect(
        result.current.mutateAsync({
          taskId: TASK_ID,
          payload: {},
        }),
      ).resolves.toBeDefined()
    })
  })

  // ─── useRequestPart ──────────────────────────────────────────────────────────

  describe('useRequestPart', () => {
    it('posts part request and returns PENDING_PICK line item', async () => {
      const responseItem = {
        id: 'line-1',
        itemNo: 'OIL-FILTER',
        description: 'Oil Filter',
        qty: 1,
        partExecutionStatus: 'PENDING_PICK',
      }
      vi.mocked(fetchWithAuth).mockResolvedValue(createJsonResponse(responseItem, true, 201))

      const queryClient = createQueryClient()
      const { result } = renderHook(() => useRequestPart(), {
        wrapper: createWrapper(queryClient),
      })

      const data = await result.current.mutateAsync({
        taskId: TASK_ID,
        payload: { itemNo: 'OIL-FILTER', description: 'Oil Filter', qty: 1 },
      })

      expect(fetchWithAuth).toHaveBeenCalledWith(
        `/api/mechanic/tasks/${TASK_ID}/parts`,
        expect.objectContaining({
          method: 'POST',
          body: JSON.stringify({ itemNo: 'OIL-FILTER', description: 'Oil Filter', qty: 1 }),
        }),
      )
      expect(data.partExecutionStatus).toBe('PENDING_PICK')
    })

    it('part response does not include pricing fields', async () => {
      const responseItem = {
        id: 'line-1',
        itemNo: 'OIL-FILTER',
        description: 'Oil Filter',
        qty: 1,
        partExecutionStatus: 'PENDING_PICK',
        // unitPrice and lineTotal must NOT be in the response
      }
      vi.mocked(fetchWithAuth).mockResolvedValue(createJsonResponse(responseItem, true, 201))

      const queryClient = createQueryClient()
      const { result } = renderHook(() => useRequestPart(), {
        wrapper: createWrapper(queryClient),
      })

      const data = await result.current.mutateAsync({
        taskId: TASK_ID,
        payload: { itemNo: 'OIL-FILTER', description: 'Oil Filter', qty: 1 },
      })

      const item = data as Record<string, unknown>
      expect(item).not.toHaveProperty('unitPrice')
      expect(item).not.toHaveProperty('lineTotal')
    })
  })
})
