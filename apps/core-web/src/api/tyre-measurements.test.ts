import { createElement } from 'react'
import type { ReactNode } from 'react'
import { onlineManager, QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { act, cleanup, renderHook, waitFor } from '@testing-library/react'
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'
import type { components } from '@/api/generated/openapi'
import { fetchWithAuth } from './client'
import { getApiErrorBody, getBadRequestFields, normalizeApiError } from './api-error'
import { tyreStorageKeys, useTyreSetAction } from './tyre-storage'
import { workshopKeys } from './workshop'
import { tyreMeasurementKeys } from './tyre-measurement-keys'
import {
  createTyreMeasurement,
  fetchTyreMeasurements,
  useCreateTyreMeasurement,
  useTyreMeasurements,
} from './tyre-measurements'
import type {
  CreateTyreMeasurement,
  CreateTyreWheel,
  TyreMeasurement,
  TyreMeasurementParent,
  TyreWheel,
} from './tyre-measurements'

vi.mock('./client', () => ({ fetchWithAuth: vi.fn() }))

const fetchMock = vi.mocked(fetchWithAuth)
const wheel: CreateTyreWheel = {
  position: 'FL',
  treadInnerMm: 6,
  treadMiddleMm: 6.5,
  treadOuterMm: 6,
  season: 'SUMMER',
  construction: 'RADIAL',
  winterMarking: 'NONE',
}
const body: CreateTyreMeasurement = {
  wheels: [wheel],
  weightClass: 'UP_TO_3500_KG',
  measuredAt: '2026-10-14T09:00:00.000Z',
  tyreSetId: 'tyre-set-1',
}
const measuredWheel: TyreWheel = {
  ...wheel,
  id: 'wheel-1',
  brand: null,
  model: null,
  size: null,
  dot: null,
  mediaId: null,
  evaluation: {
    version: 1,
    rulesVersion: 'AT_DE_2026_10',
    country: 'AT',
    evaluatedAt: '2026-10-14T09:00:00.000Z',
    weightClass: 'UP_TO_3500_KG',
    state: 'EVALUATED',
    status: 'GOOD',
    reasonCodes: [],
    minimumTreadMm: 6,
    thresholds: { legalMinimumMm: 1.6, recommendedBelowMm: 3, ordinaryMinimumMm: 1.6 },
    dot: null,
  },
}
const orderMeasurement: TyreMeasurement = {
  id: 'measurement-1',
  siteId: 'site-1',
  vehicleId: 'vehicle-1',
  workshopOrderId: 'parent-1',
  checkInId: null,
  tyreSetId: 'tyre-set-1',
  tyreSetEventId: null,
  measuredAt: '2026-10-14T09:00:00.000Z',
  measuredBy: null,
  measuredByName: 'Mechanic',
  country: 'AT',
  weightClass: 'UP_TO_3500_KG',
  weightClassSource: 'CAPTURE',
  source: 'CAPTURE',
  sourceRef: null,
  worstStatus: 'GOOD',
  wheels: [measuredWheel],
  createdAt: '2026-10-14T09:00:00.000Z',
}
const cases = [
  {
    parent: { kind: 'order', id: 'parent-1' },
    endpoint: '/api/workshop-orders/parent-1/tyre-measurements',
    measurement: orderMeasurement,
  },
  {
    parent: { kind: 'check-in', id: 'parent-1' },
    endpoint: '/api/workshop-check-ins/parent-1/tyre-measurements',
    measurement: { ...orderMeasurement, workshopOrderId: null, checkInId: 'parent-1' },
  },
] satisfies Array<{ parent: TyreMeasurementParent; endpoint: string; measurement: TyreMeasurement }>

const validationBody = {
  statusCode: 400,
  code: 'VALIDATION_FAILED',
  message: ['wheels.0.treadMiddleMm must not be less than 0'],
  field_issues: [{ field: 'wheels.0.treadMiddleMm', code: 'min' }],
  requestId: 'request-1',
}

function jsonResponse(data: unknown, status = 200): Response {
  return new Response(JSON.stringify(data), {
    status,
    headers: { 'Content-Type': 'application/json' },
  })
}

let queryClient: QueryClient
const wrapper = ({ children }: { children: ReactNode }) =>
  createElement(QueryClientProvider, { client: queryClient }, children)

beforeEach(() => {
  fetchMock.mockReset()
  queryClient = new QueryClient({
    defaultOptions: { queries: { retry: false }, mutations: { retry: false } },
  })
})

afterEach(() => {
  cleanup()
  queryClient.clear()
  onlineManager.setOnline(true)
  vi.restoreAllMocks()
})

describe.each(cases)('tyre measurements for $parent.kind', ({ parent, endpoint, measurement }) => {
  const list: components['schemas']['TyreMeasurementListResponseDto'] = {
    data: [measurement],
    meta: { total: 1, page: 1, pageSize: 20, pageCount: 1 },
  }

  it('GETs the exact parent endpoint and preserves the generated list envelope', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(list))

    await expect(fetchTyreMeasurements(parent)).resolves.toEqual(list)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(endpoint)
  })

  it('POSTs the exact parent endpoint and JSON body, returning the measurement', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(measurement, 201))

    await expect(createTyreMeasurement(parent, body)).resolves.toEqual(measurement)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  })

  it.each(['GET', 'POST'] as const)('preserves the %s error body for field validation without displaying its message', async (method) => {
    fetchMock.mockResolvedValueOnce(jsonResponse(validationBody, 400))

    const request = method === 'GET'
      ? fetchTyreMeasurements(parent)
      : createTyreMeasurement(parent, body)
    const error: unknown = await request.catch((failure: unknown) => failure)

    expect(error).toBeInstanceOf(Error)
    expect(error).toMatchObject({ status: 400 })
    expect(getApiErrorBody(error)).toEqual(validationBody)
    expect(getBadRequestFields(error)).toEqual(['wheels.0.treadMiddleMm'])
    expect(normalizeApiError(error)?.violations).toEqual(validationBody.field_issues)
    expect((error as Error).message).not.toContain('must not be less than 0')
  })

  it('loads measurements through the hook using the parent list cache', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(list))

    const { result } = renderHook(() => useTyreMeasurements(parent), { wrapper })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))
    expect(result.current.data).toEqual(list)
    expect(queryClient.getQueryData(tyreMeasurementKeys.list(parent))).toEqual(list)
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(endpoint)
  })

  it('does not fetch while explicitly disabled', () => {
    const { result } = renderHook(() => useTyreMeasurements(parent, false), { wrapper })

    expect(result.current.fetchStatus).toBe('idle')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('refreshes order and check-in measurement views together with tyre storage after creation', async () => {
    const ownKey = tyreMeasurementKeys.list(parent)
    const otherKindKey = tyreMeasurementKeys.list({
      kind: parent.kind === 'order' ? 'check-in' : 'order',
      id: parent.id,
    })
    const otherIdKey = tyreMeasurementKeys.list({ ...parent, id: 'parent-2' })
    const storageKey = tyreStorageKeys.byVehicle('vehicle-1')
    const workshopKey = workshopKeys.detail('parent-1')
    for (const key of [ownKey, otherKindKey, otherIdKey, storageKey, workshopKey]) {
      queryClient.setQueryData(key, list)
    }
    fetchMock.mockResolvedValueOnce(jsonResponse(measurement, 201))
    const { result } = renderHook(() => useCreateTyreMeasurement(parent), { wrapper })

    await act(async () => {
      await expect(result.current.mutateAsync(body)).resolves.toEqual(measurement)
    })

    for (const key of [ownKey, otherKindKey, otherIdKey, storageKey, workshopKey]) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
    }
    expect(fetchMock).toHaveBeenCalledExactlyOnceWith(endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(body),
    })
  })

  it('preserves validation errors through the mutation hook without invalidating caches on failure', async () => {
    const keys = [tyreMeasurementKeys.list(parent), tyreStorageKeys.all, workshopKeys.all]
    for (const key of keys) queryClient.setQueryData(key, list)
    fetchMock.mockResolvedValueOnce(jsonResponse(validationBody, 400))
    const { result } = renderHook(() => useCreateTyreMeasurement(parent), { wrapper })

    await act(async () => {
      await expect(result.current.mutateAsync(body)).rejects.toMatchObject({ status: 400, data: validationBody })
    })

    await waitFor(() => expect(result.current.isError).toBe(true))
    expect(getBadRequestFields(result.current.error)).toEqual(['wheels.0.treadMiddleMm'])
    for (const key of keys) {
      expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
    }
  })
})

it('refreshes linked work-order reports after a hotel measurement is recorded', async () => {
  const keys = [tyreMeasurementKeys.list({ kind: 'order', id: 'parent-1' }), workshopKeys.detail('parent-1')]
  for (const key of keys) queryClient.setQueryData(key, orderMeasurement)
  fetchMock.mockResolvedValueOnce(jsonResponse({ id: 'tyre-set-1' }))
  const { result } = renderHook(() => useTyreSetAction(), { wrapper })

  await act(async () => {
    await result.current.mutateAsync({
      id: 'tyre-set-1', action: 'inspect',
      body: { workshopOrderId: 'parent-1', wheels: [wheel], weightClass: body.weightClass },
    })
  })

  for (const key of keys) expect(queryClient.getQueryState(key)?.isInvalidated).toBe(true)
})

it.each([false, true])('keeps measurement caches unchanged for a hotel action without a saved measurement (failed: %s)', async (failed) => {
  const key = tyreMeasurementKeys.list({ kind: 'order', id: 'parent-1' })
  queryClient.setQueryData(key, orderMeasurement)
  fetchMock.mockResolvedValueOnce(jsonResponse(failed ? validationBody : { id: 'tyre-set-1' }, failed ? 400 : 200))
  const { result } = renderHook(() => useTyreSetAction(), { wrapper })

  await act(async () => {
    const request = result.current.mutateAsync({
      id: 'tyre-set-1', action: 'inspect', body: failed ? { wheels: [wheel] } : {},
    })
    if (failed) await expect(request).rejects.toBeInstanceOf(Error)
    else await request
  })

  expect(queryClient.getQueryState(key)?.isInvalidated).toBe(false)
})

it.each(['order', 'check-in', 'hotel'] as const)('rejects %s measurements offline without replaying them after reconnect', async (kind) => {
  onlineManager.setOnline(false)
  vi.spyOn(navigator, 'onLine', 'get').mockReturnValue(false)
  const { result } = renderHook(() => {
    const create = useCreateTyreMeasurement({ kind: kind === 'check-in' ? 'check-in' : 'order', id: 'parent-1' })
    const hotel = useTyreSetAction()
    return kind === 'hotel'
      ? () => hotel.mutateAsync({ id: 'tyre-set-1', action: 'inspect', body: { wheels: [wheel] } })
      : () => create.mutateAsync(body)
  }, { wrapper })

  await act(async () => {
    const request = result.current()
    void request.catch(() => undefined)
    await Promise.resolve()
    expect(queryClient.getMutationCache().getAll().every((mutation) => !mutation.state.isPaused)).toBe(true)
    await expect(request).rejects.toBeInstanceOf(TypeError)
  })
  act(() => { onlineManager.setOnline(true) })
  expect(fetchMock).not.toHaveBeenCalled()
})

it('separates list keys by both parent kind and id under the shared root', () => {
  const orderKey = tyreMeasurementKeys.list({ kind: 'order', id: 'parent-1' })

  expect(orderKey.slice(0, tyreMeasurementKeys.all.length)).toEqual(tyreMeasurementKeys.all)
  expect(orderKey).not.toEqual(tyreMeasurementKeys.list({ kind: 'check-in', id: 'parent-1' }))
  expect(orderKey).not.toEqual(tyreMeasurementKeys.list({ kind: 'order', id: 'parent-2' }))
})
