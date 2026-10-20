import { fetchJsonWithAuth } from "./api-error";
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'

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

export function useEmployees(options?: ListEmployeesOptions) {
  return useQuery<{
    data: Employee[];
    meta: EmployeesListResponse["meta"];
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
      return fetchJsonWithAuth(
        query ? `/api/employees?${query}` : "/api/employees",
        "Failed to fetch employees",
      );
    },
  });
}

export function useEmployee(id: string) {
  return useQuery<Employee>({
    queryKey: employeeKeys.detail(id),
    queryFn: async () => {
      return fetchJsonWithAuth(
        `/api/employees/${id}`,
        "Failed to fetch employee",
      );
    },
    enabled: !!id,
  });
}

export function useCreateEmployee() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateEmployeePayload) => {
      return fetchJsonWithAuth<Employee>(
        "/api/employees",
        "Failed to create employee",
        {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(payload),
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.all })
    },
  });
}

export function useUpdateEmployee() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateEmployeePayload;
    }) => {
      return fetchJsonWithAuth<Employee>(
        `/api/employees/${id}`,
        "Failed to update employee",
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(data),
        },
      );
    },
    onSuccess: (employee) => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.all })
      queryClient.invalidateQueries({ queryKey: employeeKeys.detail(employee.id) })
    },
  });
}

export function useDeleteEmployee() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      return fetchJsonWithAuth<DeleteEmployeeResponse>(
        `/api/employees/${id}`,
        "Failed to delete employee",
        {
          method: "DELETE",
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: employeeKeys.all })
    },
  });
}
