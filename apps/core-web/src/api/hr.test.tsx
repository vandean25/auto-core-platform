import type { ReactNode } from 'react'
import { QueryClient, QueryClientProvider } from '@tanstack/react-query'
import { renderHook, waitFor } from '@testing-library/react'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  HrApiError,
  hrKeys,
  useCancelLeave,
  useCreateEmployeeLeave,
  useCreateLeave,
  useHrAttendance,
  useHrEmployeeClock,
  useHrMeClock,
  useMyLeave,
  usePatchLeaveBalance,
  usePunchClock,
  usePunchEmployeeClock,
  useTeamLeave,
  useUpdateLeave,
} from './hr'
import { employeeKeys } from './employees'
import { workshopKeys } from './workshop'

const mocks = vi.hoisted(() => ({
  fetchWithAuth: vi.fn(),
}))

vi.mock('./client', () => ({
  fetchWithAuth: mocks.fetchWithAuth,
}))

function createQueryClient() {
  return new QueryClient({
    defaultOptions: {
      queries: { retry: false },
      mutations: { retry: false },
    },
  })
}

function createWrapper(queryClient: QueryClient) {
  return ({ children }: { children: ReactNode }) => (
    <QueryClientProvider client={queryClient}>{children}</QueryClientProvider>
  )
}

type JsonResponseOptions = {
  ok?: boolean
  status?: number
  rejectJson?: boolean
}

function jsonResponse(body: unknown, options: JsonResponseOptions = {}): Response {
  const json = options.rejectJson
    ? vi.fn().mockRejectedValue(new Error('invalid JSON'))
    : vi.fn().mockResolvedValue(body)

  return {
    ok: options.ok ?? true,
    status: options.status ?? 200,
    json,
  } as unknown as Response
}

describe('HR clock hooks', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('fetches the current clock state', async () => {
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse({
      state: 'CLOCKED_OUT',
      lastEvent: null,
      todayEvents: [],
    }))

    const { result } = renderHook(() => useHrMeClock(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/hr/me/clock')
  })

  it('fetches the current clock state for a selected employee', async () => {
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse({
      state: 'PAUSED',
      lastEvent: { id: 'event-1' },
      todayEvents: [],
    }))

    const { result } = renderHook(() => useHrEmployeeClock('employee-1'), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/hr/attendance/employee-1/clock')
  })

  it('posts the selected self clock event', async () => {
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse({
      state: 'CLOCKED_IN',
      event: { id: 'event-1' },
    }))

    const { result } = renderHook(() => usePunchClock(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await result.current.mutateAsync({ type: 'CLOCK_IN' })

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/hr/me/clock', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ type: 'CLOCK_IN' }),
    })
  })

  it('invalidates all HR queries after a successful self clock punch', async () => {
    const queryClient = createQueryClient()
    const invalidateQueries = vi.spyOn(queryClient, 'invalidateQueries')
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse({
      state: 'CLOCKED_IN',
      event: { id: 'event-1' },
    }))

    const { result } = renderHook(() => usePunchClock(), {
      wrapper: createWrapper(queryClient),
    })

    await result.current.mutateAsync({ type: 'CLOCK_IN' })

    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: hrKeys.all })
  })
})

describe('HR response parsing', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('parses an object NestJS error payload and preserves its HTTP status', async () => {
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse(
      { message: 'Clock is already active' },
      { ok: false, status: 409 },
    ))

    const { result } = renderHook(() => useHrMeClock(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toBeInstanceOf(HrApiError)
    expect(result.current.error).toMatchObject({
      message: 'Clock is already active',
      status: 409,
    })
  })

  it('joins an array NestJS error payload into one API error message', async () => {
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse(
      [{ message: 'Start date is required' }, { error: 'End date is invalid' }],
      { ok: false, status: 422 },
    ))

    const { result } = renderHook(() => useHrMeClock(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toMatchObject({
      message: 'Start date is required, End date is invalid',
      status: 422,
    })
  })

  it('uses the fallback message and preserves status for malformed error responses', async () => {
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse(undefined, {
      ok: false,
      status: 500,
      rejectJson: true,
    }))

    const { result } = renderHook(() => useHrMeClock(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.isError).toBe(true))

    expect(result.current.error).toMatchObject({
      message: 'Failed to fetch attendance clock',
      status: 500,
    })
  })
})

describe('HR query construction', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('omits an empty attendance employeeId and uses the same cache key as undefined', async () => {
    const from = '2026-08-01'
    const to = '2026-08-31'

    expect(hrKeys.attendance(from, to, '')).toEqual(hrKeys.attendance(from, to))
    expect(hrKeys.leave(from, to, '')).toEqual(hrKeys.leave(from, to))

    mocks.fetchWithAuth.mockResolvedValue(jsonResponse([]))

    const { result } = renderHook(() => useHrAttendance(from, to, ''), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith(
      '/api/hr/attendance?from=2026-08-01&to=2026-08-31',
    )
  })

  it('includes employeeId when constructing the attendance query string', async () => {
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse([]))

    const { result } = renderHook(
      () => useHrAttendance('2026-08-01', '2026-08-31', 'employee-1'),
      { wrapper: createWrapper(createQueryClient()) },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith(
      '/api/hr/attendance?from=2026-08-01&to=2026-08-31&employeeId=employee-1',
    )
  })

  it('constructs the my-leave query with its calendar year', async () => {
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse({ bookings: [] }))

    const { result } = renderHook(() => useMyLeave(2026), {
      wrapper: createWrapper(createQueryClient()),
    })

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/hr/me/leave?year=2026')
  })

  it('constructs the team-leave query with dates and employeeId', async () => {
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse([]))

    const { result } = renderHook(
      () => useTeamLeave('2026-08-01', '2026-08-31', 'employee-1'),
      { wrapper: createWrapper(createQueryClient()) },
    )

    await waitFor(() => expect(result.current.isSuccess).toBe(true))

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith(
      '/api/hr/leave?from=2026-08-01&to=2026-08-31&employeeId=employee-1',
    )
  })
})

describe('HR mutations', () => {
  afterEach(() => {
    vi.clearAllMocks()
  })

  it('posts a manager employee punch with its request body', async () => {
    const payload = {
      employeeId: 'employee-1',
      type: 'CLOCK_IN' as const,
      occurredAt: '2026-08-23T08:00:00.000Z',
      note: 'Manager correction',
    }
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse({}))

    const { result } = renderHook(() => usePunchEmployeeClock(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await result.current.mutateAsync(payload)

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/hr/attendance', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  })

  it('creates self leave with a POST body', async () => {
    const payload = {
      startOn: '2026-09-01',
      endOn: '2026-09-05',
      note: 'Summer vacation',
    }
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse({}))

    const { result } = renderHook(() => useCreateLeave(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await result.current.mutateAsync(payload)

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/hr/me/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  })

  it('creates employee leave with a manager POST body', async () => {
    const payload = {
      startOn: '2026-09-01',
      endOn: '2026-09-05',
      note: 'Summer vacation',
      employeeId: 'employee-1',
    }
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse({}))

    const { result } = renderHook(() => useCreateEmployeeLeave(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await result.current.mutateAsync(payload)

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/hr/leave', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  })

  it('cancels leave with the cancel POST endpoint', async () => {
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse({}))

    const { result } = renderHook(() => useCancelLeave(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await result.current.mutateAsync('leave-1')

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/hr/leave/leave-1/cancel', {
      method: 'POST',
    })
  })

  it('updates leave with a PATCH body', async () => {
    const payload = {
      startOn: '2026-09-02',
      endOn: '2026-09-06',
      note: 'Rescheduled holiday',
    }
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse({}))

    const { result } = renderHook(() => useUpdateLeave(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await result.current.mutateAsync({ id: 'leave-1', data: payload })

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith('/api/hr/leave/leave-1', {
      method: 'PATCH',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  })

  it('patches an employee leave balance with a PATCH body', async () => {
    const payload = {
      year: 2026,
      allowanceDays: 25,
      carryoverDays: 3,
    }
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse({}))

    const { result } = renderHook(() => usePatchLeaveBalance(), {
      wrapper: createWrapper(createQueryClient()),
    })

    await result.current.mutateAsync({ employeeId: 'employee-1', data: payload })

    expect(mocks.fetchWithAuth).toHaveBeenCalledWith(
      '/api/hr/employees/employee-1/leave-balance',
      {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      },
    )
  })

  it('invalidates HR, employee, and planner queries after leave creation', async () => {
    const queryClient = createQueryClient()
    const invalidateQueries = vi
      .spyOn(queryClient, 'invalidateQueries')
      .mockResolvedValue(undefined)
    mocks.fetchWithAuth.mockResolvedValue(jsonResponse({}))

    const { result } = renderHook(() => useCreateLeave(), {
      wrapper: createWrapper(queryClient),
    })

    await result.current.mutateAsync({
      startOn: '2026-09-01',
      endOn: '2026-09-05',
    })

    expect(invalidateQueries).toHaveBeenCalledTimes(3)
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: hrKeys.all })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: employeeKeys.all })
    expect(invalidateQueries).toHaveBeenCalledWith({ queryKey: workshopKeys.planner() })
  })
})
