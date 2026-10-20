import { fetchJsonWithAuth } from "./api-error";
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'

export type Bay = components['schemas']['BayResponseDto']
export type BaysListResponse = components['schemas']['BaysListResponseDto']
export type CreateBayPayload = components['schemas']['CreateBayDto']
export type UpdateBayPayload = components['schemas']['UpdateBayDto']
export type DeleteBayResponse = components['schemas']['BayDeleteResponseDto']

export type ListBaysOptions = {
  includeInactive?: boolean
  page?: number
  limit?: number
}

export const bayKeys = {
  all: ['bays'] as const,
  list: (options?: ListBaysOptions) => [...bayKeys.all, 'list', options] as const,
  detail: (id: string) => [...bayKeys.all, 'detail', id] as const,
}

export function useBays(options?: ListBaysOptions) {
  return useQuery<BaysListResponse>({
    queryKey: bayKeys.list(options),
    queryFn: async () => {
      const params = new URLSearchParams()

      if (options?.includeInactive !== undefined) {
        params.append('includeInactive', String(options.includeInactive))
      }

      if (options?.page !== undefined) {
        params.append('page', String(options.page))
      }

      if (options?.limit !== undefined) {
        params.append('limit', String(options.limit))
      }

      const query = params.toString()
      return fetchJsonWithAuth(
        query ? `/api/bays?${query}` : "/api/bays",
        "Failed to fetch bays",
      );
    },
  });
}

export function useBay(id: string) {
  return useQuery<Bay>({
    queryKey: bayKeys.detail(id),
    queryFn: async () => {
      return fetchJsonWithAuth(`/api/bays/${id}`, "Failed to fetch bay");
    },
    enabled: !!id,
  });
}

export function useCreateBay() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (payload: CreateBayPayload) => {
      return fetchJsonWithAuth<Bay>("/api/bays", "Failed to create bay", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(payload),
      });
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bayKeys.all })
    },
  });
}

export function useUpdateBay() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async ({
      id,
      data,
    }: {
      id: string;
      data: UpdateBayPayload;
    }) => {
      return fetchJsonWithAuth<Bay>(`/api/bays/${id}`, "Failed to update bay", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(data),
      });
    },
    onSuccess: (bay) => {
      queryClient.invalidateQueries({ queryKey: bayKeys.all })
      queryClient.invalidateQueries({ queryKey: bayKeys.detail(bay.id) })
    },
  });
}

export function useDeleteBay() {
  const queryClient = useQueryClient()

  return useMutation({
    mutationFn: async (id: string) => {
      return fetchJsonWithAuth<DeleteBayResponse>(
        `/api/bays/${id}`,
        "Failed to delete bay",
        {
          method: "DELETE",
        },
      );
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: bayKeys.all })
    },
  });
}
