import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { fetchWithAuth } from './client'
import type { components } from './generated/openapi'

const LOANER_VEHICLES_API = '/api/workshop/loaner-vehicles'
const LOANER_BOOKINGS_API = '/api/workshop/loaner-bookings'

export type LoanerVehicle = components['schemas']['LoanerVehicleResponseDto'] & {
  vehicle?: {
    id: string
    make: string
    model: string
    year: number
    plate: string | null
    vin: string | null
  }
}

export type LoanerVehicleListResponse = {
  data: LoanerVehicle[]
}

export type CreateLoanerVehiclePayload = components['schemas']['CreateLoanerVehicleDto']
export type UpdateLoanerVehiclePayload = components['schemas']['UpdateLoanerVehicleDto']

export type LoanerAvailabilityResponse = components['schemas']['LoanerAvailabilityResponseDto']

export type LoanerBooking = components['schemas']['LoanerBookingResponseDto'] & {
  customer?: {
    id: string
    firstName: string
    lastName: string
    companyName: string | null
  }
  loanerVehicle?: {
    id: string
    displayName: string
    siteId: string
  }
}

export type LoanerBookingListResponse = {
  data: LoanerBooking[]
  asOf?: string
}

export type CreateLoanerBookingPayload = components['schemas']['CreateLoanerBookingDto']
export type UpdateLoanerBookingPayload = components['schemas']['UpdateLoanerBookingDto']
export type HandOverLoanerBookingPayload = components['schemas']['HandOverLoanerBookingDto']
export type ReturnLoanerBookingPayload = components['schemas']['ReturnLoanerBookingDto']

export type ListLoanerFleetOptions = {
  includeInactive?: boolean
}

export const loanerKeys = {
  all: ['loaner'] as const,
  fleet: (options?: ListLoanerFleetOptions) =>
    [...loanerKeys.all, 'fleet', options] as const,
  fleetDetail: (id: string) => [...loanerKeys.all, 'fleet', id] as const,
  availability: (from: string, to: string, asOf?: string) =>
    [...loanerKeys.all, 'availability', from, to, asOf ?? ''] as const,
  bookings: (loanerVehicleId?: string) =>
    [...loanerKeys.all, 'bookings', loanerVehicleId ?? 'all'] as const,
  booking: (id: string) => [...loanerKeys.all, 'booking', id] as const,
  overdue: (asOf?: string) => [...loanerKeys.all, 'overdue', asOf ?? ''] as const,
}

async function getErrorMessage(response: Response, fallbackMessage: string) {
  const payload = (await response.json().catch(() => undefined)) as
    | { message?: string }
    | undefined
  return payload?.message || fallbackMessage
}

export function useLoanerFleet(options?: ListLoanerFleetOptions) {
  return useQuery<LoanerVehicleListResponse>({
    queryKey: loanerKeys.fleet(options),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (options?.includeInactive !== undefined) {
        params.set('includeInactive', String(options.includeInactive))
      }
      const query = params.toString()
      const response = await fetchWithAuth(
        query ? `${LOANER_VEHICLES_API}?${query}` : LOANER_VEHICLES_API,
      )
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to fetch loaner fleet'))
      }
      return response.json()
    },
  })
}

export function useLoanerVehicle(id: string) {
  return useQuery<LoanerVehicle>({
    queryKey: loanerKeys.fleetDetail(id),
    queryFn: async () => {
      const response = await fetchWithAuth(`${LOANER_VEHICLES_API}/${id}`)
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to fetch loaner vehicle'))
      }
      return response.json()
    },
    enabled: Boolean(id),
  })
}

export function useCreateLoanerVehicle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateLoanerVehiclePayload) => {
      const response = await fetchWithAuth(LOANER_VEHICLES_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to create loaner vehicle'))
      }
      return response.json() as Promise<LoanerVehicle>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: loanerKeys.all })
    },
  })
}

export function useUpdateLoanerVehicle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateLoanerVehiclePayload }) => {
      const response = await fetchWithAuth(`${LOANER_VEHICLES_API}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to update loaner vehicle'))
      }
      return response.json() as Promise<LoanerVehicle>
    },
    onSuccess: (vehicle) => {
      queryClient.invalidateQueries({ queryKey: loanerKeys.all })
      queryClient.invalidateQueries({ queryKey: loanerKeys.fleetDetail(vehicle.id) })
    },
  })
}

export function useDeleteLoanerVehicle() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`${LOANER_VEHICLES_API}/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to remove loaner vehicle'))
      }
      return response.json() as Promise<{ id?: string; deleted?: boolean }>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: loanerKeys.all })
    },
  })
}

export function useLoanerAvailability(from: string, to: string, asOf?: string) {
  return useQuery<LoanerAvailabilityResponse>({
    queryKey: loanerKeys.availability(from, to, asOf),
    queryFn: async () => {
      const params = new URLSearchParams({ from, to })
      if (asOf) params.set('asOf', asOf)
      const response = await fetchWithAuth(
        `${LOANER_VEHICLES_API}/availability?${params.toString()}`,
      )
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to fetch loaner availability'))
      }
      return response.json()
    },
    enabled: Boolean(from && to),
  })
}

async function fetchLoanerBookings(): Promise<LoanerBookingListResponse> {
  const response = await fetchWithAuth(LOANER_BOOKINGS_API)
  if (!response.ok) {
    throw new Error(await getErrorMessage(response, 'Failed to fetch loaner bookings'))
  }
  return response.json()
}

export function useLoanerBookings(loanerVehicleId?: string) {
  return useQuery<LoanerBookingListResponse>({
    queryKey: loanerKeys.bookings(loanerVehicleId),
    queryFn: async () => {
      const json = await fetchLoanerBookings()
      if (!loanerVehicleId) {
        return json
      }
      return {
        ...json,
        data: (json.data ?? []).filter(
          (booking) => booking.loanerVehicleId === loanerVehicleId,
        ),
      }
    },
  })
}

export function useLoanerBooking(id: string) {
  return useQuery<LoanerBooking>({
    queryKey: loanerKeys.booking(id),
    queryFn: async () => {
      const response = await fetchWithAuth(`${LOANER_BOOKINGS_API}/${id}`)
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to fetch loaner booking'))
      }
      return response.json()
    },
    enabled: Boolean(id),
  })
}

export function useCreateLoanerBooking() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateLoanerBookingPayload) => {
      const response = await fetchWithAuth(LOANER_BOOKINGS_API, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to create loaner booking'))
      }
      return response.json() as Promise<LoanerBooking>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: loanerKeys.all })
    },
  })
}

export function useUpdateLoanerBooking() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateLoanerBookingPayload }) => {
      const response = await fetchWithAuth(`${LOANER_BOOKINGS_API}/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to update loaner booking'))
      }
      return response.json() as Promise<LoanerBooking>
    },
    onSuccess: (booking) => {
      queryClient.invalidateQueries({ queryKey: loanerKeys.all })
      queryClient.invalidateQueries({ queryKey: loanerKeys.booking(booking.id) })
    },
  })
}

export function useCancelLoanerBooking() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`${LOANER_BOOKINGS_API}/${id}/cancel`, {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to cancel loaner booking'))
      }
      return response.json() as Promise<LoanerBooking>
    },
    onSuccess: (booking) => {
      queryClient.invalidateQueries({ queryKey: loanerKeys.all })
      queryClient.invalidateQueries({ queryKey: loanerKeys.booking(booking.id) })
    },
  })
}

export function useHandOverLoanerBooking() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string
      data: HandOverLoanerBookingPayload
    }) => {
      const response = await fetchWithAuth(`${LOANER_BOOKINGS_API}/${id}/hand-over`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to record hand-over'))
      }
      return response.json() as Promise<LoanerBooking>
    },
    onSuccess: (booking) => {
      queryClient.invalidateQueries({ queryKey: loanerKeys.all })
      queryClient.invalidateQueries({ queryKey: loanerKeys.booking(booking.id) })
    },
  })
}

export function useReturnLoanerBooking() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string
      data: ReturnLoanerBookingPayload
    }) => {
      const response = await fetchWithAuth(`${LOANER_BOOKINGS_API}/${id}/return`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to record return'))
      }
      return response.json() as Promise<LoanerBooking>
    },
    onSuccess: (booking) => {
      queryClient.invalidateQueries({ queryKey: loanerKeys.all })
      queryClient.invalidateQueries({ queryKey: loanerKeys.booking(booking.id) })
    },
  })
}

export function useOverdueLoanerBookings(asOf?: string) {
  return useQuery<LoanerBookingListResponse>({
    queryKey: loanerKeys.overdue(asOf),
    queryFn: async () => {
      const params = new URLSearchParams()
      if (asOf) params.set('asOf', asOf)
      const query = params.toString()
      const response = await fetchWithAuth(
        query ? `${LOANER_BOOKINGS_API}/overdue?${query}` : `${LOANER_BOOKINGS_API}/overdue`,
      )
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to fetch overdue loaner bookings'))
      }
      return response.json()
    },
  })
}

export function getLoanerBookingCustomerLabel(booking: LoanerBooking) {
  if (booking.customer?.companyName) {
    return booking.customer.companyName
  }
  if (booking.customer) {
    return `${booking.customer.firstName} ${booking.customer.lastName}`.trim()
  }
  return booking.customerId
}
