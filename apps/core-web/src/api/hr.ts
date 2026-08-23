import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { QueryClient } from '@tanstack/react-query'
import { employeeKeys } from './employees'
import { fetchWithAuth } from './client'
import type { components } from './generated/openapi'
import { workshopKeys } from './workshop'

const HR_API = '/api/hr'

export type HrMeResponse = components['schemas']['HrMeResponseDto']
export type HrClockResponse = components['schemas']['ClockResponseDto']
export type PunchClockPayload = components['schemas']['PunchClockDto']
export type PunchResponse = components['schemas']['PunchResponseDto']
export type AttendanceEvent = components['schemas']['AttendanceEventResponseDto']
export type CreateHrAttendancePayload = components['schemas']['CreateHrAttendanceDto']
export type MyLeaveResponse = components['schemas']['MyLeaveResponseDto']
export type CreateLeavePayload = components['schemas']['CreateMyLeaveDto']
export type CreateEmployeeLeavePayload = components['schemas']['CreateEmployeeLeaveDto']
export type LeaveRequest = components['schemas']['LeaveRequestResponseDto']
export type UpdateLeavePayload = components['schemas']['UpdateLeaveRequestDto']
export type PatchLeaveBalancePayload = components['schemas']['PatchLeaveBalanceDto']
export type LeaveBalanceResponse = components['schemas']['LeaveBalanceResponseDto']

export const hrKeys = {
  all: ['hr'] as const,
  me: () => [...hrKeys.all, 'me'] as const,
  clock: () => [...hrKeys.all, 'clock'] as const,
  attendance: (from: string, to: string, employeeId?: string) =>
    [...hrKeys.all, 'attendance', from, to, employeeId ?? 'all'] as const,
  myLeave: (year: number) => [...hrKeys.all, 'me-leave', year] as const,
  leave: (from: string, to: string, employeeId?: string) =>
    [...hrKeys.all, 'leave', from, to, employeeId ?? 'all'] as const,
}

export class HrApiError extends Error {
  readonly status: number

  constructor(message: string, status: number) {
    super(message)
    this.name = 'HrApiError'
    this.status = status
  }
}

function extractErrorMessage(value: unknown): string | undefined {
  if (typeof value === 'string') return value

  if (Array.isArray(value)) {
    const messages = value
      .map((entry) => extractErrorMessage(entry))
      .filter((message): message is string => Boolean(message))

    return messages.length > 0 ? messages.join(', ') : undefined
  }

  if (value && typeof value === 'object') {
    const record = value as Record<string, unknown>
    return extractErrorMessage(record.message) ?? extractErrorMessage(record.error)
  }

  return undefined
}

async function parseHrResponse<T>(response: Response, fallbackMessage: string): Promise<T> {
  if (!response.ok) {
    const payload = await response.json().catch(() => undefined) as unknown
    throw new HrApiError(extractErrorMessage(payload) ?? fallbackMessage, response.status)
  }

  return response.json() as Promise<T>
}

function addQueryParameter(params: URLSearchParams, name: string, value?: string) {
  if (value) params.set(name, value)
}

function withQuery(path: string, params: URLSearchParams): string {
  const query = params.toString()
  return query ? `${path}?${query}` : path
}

async function invalidateHrQueries(queryClient: QueryClient): Promise<void> {
  await queryClient.invalidateQueries({ queryKey: hrKeys.all })
}

async function invalidateLeaveQueries(queryClient: QueryClient): Promise<void> {
  await Promise.all([
    queryClient.invalidateQueries({ queryKey: hrKeys.all }),
    queryClient.invalidateQueries({ queryKey: employeeKeys.all }),
    queryClient.invalidateQueries({ queryKey: workshopKeys.planner() }),
  ])
}

export function useHrMe() {
  return useQuery<HrMeResponse, HrApiError>({
    queryKey: hrKeys.me(),
    queryFn: async () => {
      const response = await fetchWithAuth(`${HR_API}/me`)
      return parseHrResponse<HrMeResponse>(response, 'Failed to fetch HR profile')
    },
  })
}

export function useHrMeClock() {
  return useQuery<HrClockResponse, HrApiError>({
    queryKey: hrKeys.clock(),
    queryFn: async () => {
      const response = await fetchWithAuth(`${HR_API}/me/clock`)
      return parseHrResponse<HrClockResponse>(response, 'Failed to fetch attendance clock')
    },
  })
}

export function useHrAttendance(from: string, to: string, employeeId?: string) {
  return useQuery<AttendanceEvent[], HrApiError>({
    queryKey: hrKeys.attendance(from, to, employeeId),
    queryFn: async () => {
      const params = new URLSearchParams({ from, to })
      addQueryParameter(params, 'employeeId', employeeId)
      const response = await fetchWithAuth(withQuery(`${HR_API}/attendance`, params))
      return parseHrResponse<AttendanceEvent[]>(response, 'Failed to fetch attendance')
    },
  })
}

export function useMyLeave(year: number) {
  return useQuery<MyLeaveResponse, HrApiError>({
    queryKey: hrKeys.myLeave(year),
    queryFn: async () => {
      const params = new URLSearchParams({ year: String(year) })
      const response = await fetchWithAuth(withQuery(`${HR_API}/me/leave`, params))
      return parseHrResponse<MyLeaveResponse>(response, 'Failed to fetch leave bookings')
    },
  })
}

export function useTeamLeave(from = '', to = '', employeeId?: string) {
  return useQuery<LeaveRequest[], HrApiError>({
    queryKey: hrKeys.leave(from, to, employeeId),
    queryFn: async () => {
      const params = new URLSearchParams()
      addQueryParameter(params, 'from', from)
      addQueryParameter(params, 'to', to)
      addQueryParameter(params, 'employeeId', employeeId)
      const response = await fetchWithAuth(withQuery(`${HR_API}/leave`, params))
      return parseHrResponse<LeaveRequest[]>(response, 'Failed to fetch team leave')
    },
  })
}

export function usePunchClock() {
  const queryClient = useQueryClient()

  return useMutation<PunchResponse, HrApiError, PunchClockPayload>({
    mutationFn: async (payload) => {
      const response = await fetchWithAuth(`${HR_API}/me/clock`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return parseHrResponse<PunchResponse>(response, 'Failed to punch attendance clock')
    },
    onSuccess: () => invalidateHrQueries(queryClient),
  })
}

export function usePunchEmployeeClock() {
  const queryClient = useQueryClient()

  return useMutation<PunchResponse, HrApiError, CreateHrAttendancePayload>({
    mutationFn: async (payload) => {
      const response = await fetchWithAuth(`${HR_API}/attendance`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return parseHrResponse<PunchResponse>(response, 'Failed to punch employee attendance')
    },
    onSuccess: () => invalidateHrQueries(queryClient),
  })
}

export function useCreateLeave() {
  const queryClient = useQueryClient()

  return useMutation<LeaveRequest, HrApiError, CreateLeavePayload>({
    mutationFn: async (payload) => {
      const response = await fetchWithAuth(`${HR_API}/me/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return parseHrResponse<LeaveRequest>(response, 'Failed to create leave booking')
    },
    onSuccess: () => invalidateLeaveQueries(queryClient),
  })
}

export function useCreateEmployeeLeave() {
  const queryClient = useQueryClient()

  return useMutation<LeaveRequest, HrApiError, CreateEmployeeLeavePayload>({
    mutationFn: async (payload) => {
      const response = await fetchWithAuth(`${HR_API}/leave`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      return parseHrResponse<LeaveRequest>(response, 'Failed to create employee leave booking')
    },
    onSuccess: () => invalidateLeaveQueries(queryClient),
  })
}

export function useCancelLeave() {
  const queryClient = useQueryClient()

  return useMutation<LeaveRequest, HrApiError, string>({
    mutationFn: async (id) => {
      const response = await fetchWithAuth(`${HR_API}/leave/${id}/cancel`, {
        method: 'POST',
      })
      return parseHrResponse<LeaveRequest>(response, 'Failed to cancel leave booking')
    },
    onSuccess: () => invalidateLeaveQueries(queryClient),
  })
}

export function useUpdateLeave() {
  const queryClient = useQueryClient()

  return useMutation<LeaveRequest, HrApiError, { id: string; data: UpdateLeavePayload }>({
    mutationFn: async ({ id, data }) => {
      const response = await fetchWithAuth(`${HR_API}/leave/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      return parseHrResponse<LeaveRequest>(response, 'Failed to update leave booking')
    },
    onSuccess: () => invalidateLeaveQueries(queryClient),
  })
}

export function usePatchLeaveBalance() {
  const queryClient = useQueryClient()

  return useMutation<LeaveBalanceResponse, HrApiError, { employeeId: string; data: PatchLeaveBalancePayload }>({
    mutationFn: async ({ employeeId, data }) => {
      const response = await fetchWithAuth(`${HR_API}/employees/${employeeId}/leave-balance`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      return parseHrResponse<LeaveBalanceResponse>(response, 'Failed to update leave balance')
    },
    onSuccess: () => invalidateLeaveQueries(queryClient),
  })
}
