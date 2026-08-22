import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, render, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import { authSessionKeys } from '@/api/auth-session'
import { mechanicQueueKeys } from '@/api/mechanic'
import { purchaseInvoiceKeys } from '@/api/usePurchaseInvoices'
import { vehicleStockKeys } from '@/api/vehicle-stock'
import { workshopKeys } from '@/api/workshop'
import {
  RealtimeDashboardSyncProvider,
  resolveRealtimeConnection,
} from './RealtimeDashboardSyncProvider'
import { AUTH_CLAIMS_UPDATED_EVENT, ENTITY_UPDATED_EVENT } from './types'

const mocks = vi.hoisted(() => {
  const socket = {
    on: vi.fn(),
    off: vi.fn(),
    disconnect: vi.fn(),
  }

  return {
    io: vi.fn(() => socket),
    socket,
    useAuth: vi.fn(),
    currentUser: {
      getIdToken: vi.fn(),
    },
  }
})

vi.mock('socket.io-client', () => ({
  io: mocks.io,
}))

vi.mock('@/api/client', () => ({
  API_BASE_URL: 'http://127.0.0.1:3000',
}))

vi.mock('@/auth/AuthProvider', () => ({
  useAuth: mocks.useAuth,
}))

vi.mock('@/lib/firebase', () => ({
  firebaseAuth: {
    currentUser: mocks.currentUser,
  },
  firebaseConfigMissing: false,
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
    <QueryClientProvider client={client}>
      <RealtimeDashboardSyncProvider>{children}</RealtimeDashboardSyncProvider>
    </QueryClientProvider>
  )
}

describe('RealtimeDashboardSyncProvider', () => {
  beforeEach(() => {
    vi.clearAllMocks()

    const user = {
      uid: 'user-1',
      email: 'admin@autocore.com',
      displayName: 'Admin',
      getIdToken: vi.fn().mockResolvedValue('initial-token'),
      getIdTokenResult: vi.fn(),
    }

    mocks.currentUser.getIdToken.mockResolvedValue('refreshed-token')
    mocks.useAuth.mockReturnValue({
      user,
      signOutUser: vi.fn().mockResolvedValue(undefined),
    })
  })

  afterEach(() => {
    vi.unstubAllEnvs()
    vi.clearAllMocks()
  })

  it('does not open a socket connection when e2e auth bypass mode is enabled', async () => {
    vi.stubEnv('VITE_E2E_SKIP_AUTH', 'true')

    const queryClient = createQueryClient()

    render(<div />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(mocks.io).not.toHaveBeenCalled()
    })
  })

  it('uses the dedicated dev socket proxy path when only the browser origin is available', () => {
    expect(
      resolveRealtimeConnection({
        apiBaseUrl: '',
        currentOrigin: 'http://localhost:5173',
      }),
    ).toEqual({
      url: 'http://localhost:5173/dashboard-realtime',
      path: '/socket.io',
    })
  })

  it('uses the Hosting socket path for an empty API base in production', () => {
    expect(
      resolveRealtimeConnection({
        apiBaseUrl: '',
        currentOrigin: 'https://auto-core-platform-vande.web.app',
        isDev: false,
      }),
    ).toEqual({
      url: 'https://auto-core-platform-vande.web.app/dashboard-realtime',
      path: '/api/socket.io',
    })
  })

  it('uses the backend socket path when an API base URL is configured', () => {
    expect(
      resolveRealtimeConnection({
        apiBaseUrl: 'http://127.0.0.1:3000',
        currentOrigin: 'http://localhost:5173',
      }),
    ).toEqual({
      url: 'http://127.0.0.1:3000/dashboard-realtime',
      path: '/api/socket.io',
    })
  })

  it('uses socketBaseUrl for websocket connection when apiBaseUrl is empty', () => {
    expect(
      resolveRealtimeConnection({
        apiBaseUrl: '',
        socketBaseUrl: 'https://core-api-895976476759.europe-west3.run.app',
        currentOrigin: 'https://auto-core-platform-vande.web.app',
      }),
    ).toEqual({
      url: 'https://core-api-895976476759.europe-west3.run.app/dashboard-realtime',
      path: '/api/socket.io',
    })
  })

  it('refreshes claims and invalidates active queries when auth claims change', async () => {
    const queryClient = createQueryClient()
    const removeQueries = vi.spyOn(queryClient, 'removeQueries')
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)

    render(<div />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(mocks.io).toHaveBeenCalledWith(
        'http://127.0.0.1:3000/dashboard-realtime',
        expect.objectContaining({
          auth: { token: 'initial-token' },
          path: '/api/socket.io',
        }),
      )
    })

    const claimsUpdatedHandler = mocks.socket.on.mock.calls.find(
      ([eventName]) => eventName === AUTH_CLAIMS_UPDATED_EVENT,
    )?.[1] as ((payload: unknown) => void) | undefined

    expect(claimsUpdatedHandler).toBeDefined()

    await act(async () => {
      claimsUpdatedHandler?.({
        reason: 'membership-updated',
        timestamp: '2026-04-23T15:00:00.000Z',
      })
    })

    await waitFor(() => {
      expect(mocks.currentUser.getIdToken).toHaveBeenCalledWith(true)
      expect(removeQueries).toHaveBeenCalledWith(
        expect.objectContaining({
          type: 'inactive',
          predicate: expect.any(Function),
        }),
      )
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: authSessionKeys.all,
        refetchType: 'active',
      })
      expect(invalidateQueries).toHaveBeenCalledWith({ refetchType: 'active' })
    })
  })

  // ─── entity_updated → cache invalidation (Service Advisor / task-detail) ──

  it('invalidates WORKSHOP_TASK dashboard source keys when a valid entity_updated event is received', async () => {
    const queryClient = createQueryClient()
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)

    render(<div />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(mocks.socket.on).toHaveBeenCalledWith(ENTITY_UPDATED_EVENT, expect.any(Function))
    })

    const entityUpdatedHandler = mocks.socket.on.mock.calls.find(
      ([eventName]) => eventName === ENTITY_UPDATED_EVENT,
    )?.[1] as ((payload: unknown) => void) | undefined

    expect(entityUpdatedHandler).toBeDefined()

    await act(async () => {
      entityUpdatedHandler?.({
        type: 'WORKSHOP_TASK',
        action: 'UPDATED',
        entityId: 'task-123',
        timestamp: '2026-05-01T10:00:00.000Z',
      })
    })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['dashboard-widget-data', 'workshop-tasks'],
        refetchType: 'active',
      })
    })
  })

  it('invalidates the expected dashboard source keys for each known entity type', async () => {
    const queryClient = createQueryClient()
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)

    render(<div />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(mocks.socket.on).toHaveBeenCalledWith(ENTITY_UPDATED_EVENT, expect.any(Function))
    })

    const entityUpdatedHandler = mocks.socket.on.mock.calls.find(
      ([eventName]) => eventName === ENTITY_UPDATED_EVENT,
    )?.[1] as ((payload: unknown) => void) | undefined

    expect(entityUpdatedHandler).toBeDefined()

    const entityTypeToExpectedKey: Array<[string, string]> = [
      ['WORKSHOP_TASK', 'workshop-tasks'],
      ['WORKSHOP_ORDER', 'workshop-orders'],
      ['WORKSHOP_TASK_LINE_ITEM', 'workshop-task-line-items'],
    ]

    for (const [entityType, expectedSourceKey] of entityTypeToExpectedKey) {
      invalidateQueries.mockClear()

      await act(async () => {
        entityUpdatedHandler?.({
          type: entityType,
          action: 'UPDATED',
          entityId: `entity-${entityType.toLowerCase()}`,
          timestamp: '2026-05-01T10:00:00.000Z',
        })
      })

      await waitFor(() => {
        expect(invalidateQueries).toHaveBeenCalledWith({
          queryKey: ['dashboard-widget-data', expectedSourceKey],
          refetchType: 'active',
        })
      })
    }
  })

  it('does not call invalidateQueries when an entity_updated event has an invalid payload', async () => {
    const queryClient = createQueryClient()
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)

    render(<div />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(mocks.socket.on).toHaveBeenCalledWith(ENTITY_UPDATED_EVENT, expect.any(Function))
    })

    const entityUpdatedHandler = mocks.socket.on.mock.calls.find(
      ([eventName]) => eventName === ENTITY_UPDATED_EVENT,
    )?.[1] as ((payload: unknown) => void) | undefined

    expect(entityUpdatedHandler).toBeDefined()

    await act(async () => {
      // Malformed — missing timestamp
      entityUpdatedHandler?.({ type: 'WORKSHOP_TASK', action: 'UPDATED' })
      // Malformed — unknown type
      entityUpdatedHandler?.({ type: 'UNKNOWN_ENTITY', action: 'CREATED', timestamp: '2026-05-01T10:00:00.000Z' })
      // Null payload
      entityUpdatedHandler?.(null)
    })

    // The handler should early-return for malformed payloads without triggering any invalidation
    expect(invalidateQueries).not.toHaveBeenCalled()
  })

  it('invalidates workshop domain keys when a WORKSHOP_ORDER event is received', async () => {
    const queryClient = createQueryClient()
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)

    render(<div />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(mocks.socket.on).toHaveBeenCalledWith(ENTITY_UPDATED_EVENT, expect.any(Function))
    })

    const entityUpdatedHandler = mocks.socket.on.mock.calls.find(
      ([eventName]) => eventName === ENTITY_UPDATED_EVENT,
    )?.[1] as ((payload: unknown) => void) | undefined

    expect(entityUpdatedHandler).toBeDefined()

    await act(async () => {
      entityUpdatedHandler?.({
        type: 'WORKSHOP_ORDER',
        action: 'UPDATED',
        entityId: 'order-123',
        timestamp: '2026-05-01T10:00:00.000Z',
      })
    })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['dashboard-widget-data', 'workshop-orders'],
        refetchType: 'active',
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: workshopKeys.all,
        refetchType: 'active',
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: mechanicQueueKeys.all,
        refetchType: 'active',
      })
    })
  })

  it('invalidates purchase-invoice domain keys when a PURCHASE_INVOICE event is received', async () => {
    const queryClient = createQueryClient()
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)

    render(<div />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(mocks.socket.on).toHaveBeenCalledWith(ENTITY_UPDATED_EVENT, expect.any(Function))
    })

    const entityUpdatedHandler = mocks.socket.on.mock.calls.find(
      ([eventName]) => eventName === ENTITY_UPDATED_EVENT,
    )?.[1] as ((payload: unknown) => void) | undefined

    expect(entityUpdatedHandler).toBeDefined()

    await act(async () => {
      entityUpdatedHandler?.({
        type: 'PURCHASE_INVOICE',
        action: 'CREATED',
        entityId: 'invoice-123',
        timestamp: '2026-05-01T10:00:00.000Z',
      })
    })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['dashboard-widget-data', 'purchase-bills'],
        refetchType: 'active',
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['dashboard-widget-data', 'purchase-invoices'],
        refetchType: 'active',
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: purchaseInvoiceKeys.all,
        refetchType: 'active',
      })
    })
  })

  it('preserves vehicle-stock domain invalidation for vehicle stock events', async () => {
    const queryClient = createQueryClient()
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)

    render(<div />, { wrapper: createWrapper(queryClient) })

    await waitFor(() => {
      expect(mocks.socket.on).toHaveBeenCalledWith(ENTITY_UPDATED_EVENT, expect.any(Function))
    })

    const entityUpdatedHandler = mocks.socket.on.mock.calls.find(
      ([eventName]) => eventName === ENTITY_UPDATED_EVENT,
    )?.[1] as ((payload: unknown) => void) | undefined

    expect(entityUpdatedHandler).toBeDefined()

    await act(async () => {
      entityUpdatedHandler?.({
        type: 'VEHICLE_PURCHASE',
        action: 'UPDATED',
        entityId: 'purchase-123',
        timestamp: '2026-05-01T10:00:00.000Z',
      })
    })

    await waitFor(() => {
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: ['dashboard-widget-data', 'vehicle-stock'],
        refetchType: 'active',
      })
      expect(invalidateQueries).toHaveBeenCalledWith({
        queryKey: vehicleStockKeys.all,
        refetchType: 'active',
      })
    })
  })
})