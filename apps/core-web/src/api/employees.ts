import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'

export type EmployeeRole = components['schemas']['EmployeeRole']
export type Employee = Omit<components['schemas']['EmployeeResponseDto'], 'userId' | 'motherLanguageCode'> & {
  userId?: string | null
  motherLanguageCode?: string | null
}
export type EmployeesListResponse = components['schemas']['EmployeesListResponseDto']
export type CreateEmployeePayload = Omit<components['schemas']['CreateEmployeeDto'], 'motherLanguageCode'> & {
  motherLanguageCode?: string | null
}
export type UpdateEmployeePayload = Omit<
  components['schemas']['UpdateEmployeeDto'],
  'userId' | 'motherLanguageCode'
> & {
  userId?: string | null
  motherLanguageCode?: string | null
}
export type DeleteEmployeeResponse = components['schemas']['EmployeeDeleteResponseDto']

export type ListEmployeesOptions = {
  includeInactive?: boolean
  role?: EmployeeRole
  page?: number
  limit?: number
}

export const employeeKeys = {
  all: ['employees'] as const,
  list: (options?: ListEmployeesOptions) => [...employeeKeys.all, 'list', options] as const,
  detail: (id: string) => [...employeeKeys.all, 'detail', id] as const,
}

async function getErrorMessage(response: Response, fallbackMessage: string) {
  const payload = await response.json().catch(() => undefined) as { message?: string } | undefined
  return payload?.message || fallbackMessage
}

export function useEmployees(options?: ListEmployeesOptions) {
  return useQuery<{
    data: Employee[]
    meta: EmployeesListResponse['meta']
  }>({
    queryKey: employeeKeys.list(options),
    queryFn: async () => {
      const params = new URLSearchParams()

      if (options?.includeInactive !== undefined) {
        params.append('includeInactive', String(options.includeInactive))
      }

      if (options?.role) {
        params.append('role', options.role)
      }

      if (options?.page !== undefined) {
        params.append('page', String(options.page))
      }

      if (options?.limit !== undefined) {
        params.append('limit', String(options.limit))
      }

      const query = params.toString()
      const response = await fetchWithAuth(query ? `/api/employees?${query}` : '/api/employees')
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to fetch employees'))
      }

      return response.json()
    },
  })
}

export function useEmployee(id: string) {
  return useQuery<Employee>({
    queryKey: employeeKeys.detail(id),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/employees/${id}`)
      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to fetch employee'))
      }

      return response.json()
    },
    enabled: !!id,
  })
}

export function useCreateEmployee() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateEmployeePayload) => {
      const response = await fetchWithAuth('/api/employees', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to create employee'))
      }

      return response.json() as Promise<Employee>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.all })
    },
  })
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({ id, data }: { id: string; data: UpdateEmployeePayload }) => {
      const response = await fetchWithAuth(`/api/employees/${id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(data),
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to update employee'))
      }

      return response.json() as Promise<Employee>
    },
    onSuccess: (employee) => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.all })
      queryClient.invalidateQueries({ queryKey: employeeKeys.detail(employee.id) })
    },
  })
}

export function useDeleteEmployee() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      const response = await fetchWithAuth(`/api/employees/${id}`, {
        method: 'DELETE',
      })

      if (!response.ok) {
        throw new Error(await getErrorMessage(response, 'Failed to delete employee'))
      }

      return response.json() as Promise<DeleteEmployeeResponse>
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.all })
    },
  })
}
