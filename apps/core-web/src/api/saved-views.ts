import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import { optimisticMutationOptions } from '@/lib/optimistic-mutation'
import { fetchJsonWithAuth } from './api-error'
import type { components } from './generated/openapi'

export type SavedViewVisibility = components['schemas']['SavedViewVisibility']
export type SavedViewDto = components['schemas']['SavedViewDto']
export type SavedViewsListResponseDto = components['schemas']['SavedViewsListResponseDto']
export type CreateSavedViewDto = components['schemas']['CreateSavedViewDto']
export type UpdateSavedViewDto = components['schemas']['UpdateSavedViewDto']
export type CopySavedViewDto = components['schemas']['CopySavedViewDto']

export const savedViewKeys = {
  all: ['saved-views'] as const,
  list: (tenantId?: string | null, userKey?: string, listPath?: string) =>
    listPath !== undefined
      ? ([...savedViewKeys.all, 'list', tenantId ?? 'none', userKey ?? 'anon', listPath] as const)
      : ([...savedViewKeys.all, 'list', tenantId ?? 'none', userKey ?? 'anon'] as const),
}

export function useSavedViewsQuery(options: {
  tenantId?: string | null
  userKey?: string
  listPath?: string
  enabled?: boolean
}) {
  const { tenantId, userKey, listPath, enabled } = options
  const queryPath =
    listPath !== undefined
      ? `/api/saved-views?listPath=${encodeURIComponent(listPath)}`
      : '/api/saved-views'

  return useQuery<SavedViewsListResponseDto>({
    queryKey: savedViewKeys.list(tenantId, userKey, listPath),
    enabled: enabled ?? Boolean(tenantId),
    queryFn: async () =>
      fetchJsonWithAuth<SavedViewsListResponseDto>(queryPath, 'Failed to load saved views'),
  })
}

export function useCreateSavedView(tenantId?: string | null, userKey?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [...savedViewKeys.all, 'create'],
    mutationFn: async (payload: CreateSavedViewDto) =>
      fetchJsonWithAuth<SavedViewDto>('/api/saved-views', 'Failed to create saved view', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      }),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: savedViewKeys.list(tenantId, userKey) })
    },
  })
}

export type RenameSavedViewVariables = {
  id: string
  name: string
  version: number
}

export function useRenameSavedView(tenantId?: string | null, userKey?: string) {
  return useMutation({
    ...optimisticMutationOptions<SavedViewsListResponseDto, RenameSavedViewVariables>({
      queryKey: savedViewKeys.list(tenantId, userKey),
      mutationKey: [...savedViewKeys.all, 'rename'],
      entityId: ({ id }) => id,
      apply: (cache, { id, name }) => ({
        ...cache,
        data: cache.data.map((view) => (view.id === id ? { ...view, name } : view)),
      }),
      revert: (cache, { id }, snapshot) => {
        const previous = snapshot.data.find((view) => view.id === id)
        if (!previous) return cache
        return {
          ...cache,
          data: cache.data.map((view) => (view.id === id ? previous : view)),
        }
      },
    }),
    mutationFn: async ({ id, name, version }: RenameSavedViewVariables) =>
      fetchJsonWithAuth<SavedViewDto>(
        `/api/saved-views/${encodeURIComponent(id)}`,
        'Failed to rename saved view',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ name, version } satisfies UpdateSavedViewDto),
        },
      ),
  })
}

export type RemoveSavedViewVariables = {
  id: string
  version: number
}

export function useRemoveSavedView(tenantId?: string | null, userKey?: string) {
  return useMutation({
    ...optimisticMutationOptions<SavedViewsListResponseDto, RemoveSavedViewVariables>({
      queryKey: savedViewKeys.list(tenantId, userKey),
      mutationKey: [...savedViewKeys.all, 'delete'],
      entityId: ({ id }) => id,
      apply: (cache, { id }) => ({
        ...cache,
        data: cache.data.filter((view) => view.id !== id),
      }),
      revert: (cache, { id }, snapshot) => {
        const previous = snapshot.data.find((view) => view.id === id)
        if (!previous || cache.data.some((view) => view.id === id)) return cache
        const index = snapshot.data.findIndex((view) => view.id === id)
        const next = [...cache.data]
        next.splice(Math.min(index, next.length), 0, previous)
        return { ...cache, data: next }
      },
    }),
    mutationFn: async ({ id, version }: RemoveSavedViewVariables) =>
      fetchJsonWithAuth<void>(
        `/api/saved-views/${encodeURIComponent(id)}?version=${encodeURIComponent(String(version))}`,
        'Failed to delete saved view',
        { method: 'DELETE' },
      ),
  })
}

export type ShareSavedViewVariables = {
  id: string
  visibility: SavedViewVisibility
  version: number
}

export function useShareSavedView(tenantId?: string | null, userKey?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [...savedViewKeys.all, 'share'],
    mutationFn: async ({ id, visibility, version }: ShareSavedViewVariables) =>
      fetchJsonWithAuth<SavedViewDto>(
        `/api/saved-views/${encodeURIComponent(id)}`,
        'Failed to update saved view visibility',
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ visibility, version } satisfies UpdateSavedViewDto),
        },
      ),
    onSettled: async () => {
      await queryClient.invalidateQueries({ queryKey: savedViewKeys.list(tenantId, userKey) })
    },
  })
}

export type CopySavedViewVariables = {
  id: string
  name?: string
}

export function useCopySavedView(tenantId?: string | null, userKey?: string) {
  const queryClient = useQueryClient()

  return useMutation({
    mutationKey: [...savedViewKeys.all, 'copy'],
    mutationFn: async ({ id, name }: CopySavedViewVariables) =>
      fetchJsonWithAuth<SavedViewDto>(
        `/api/saved-views/${encodeURIComponent(id)}/copy`,
        'Failed to copy saved view',
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify((name ? { name } : {}) satisfies CopySavedViewDto),
        },
      ),
    onSuccess: async () => {
      await queryClient.invalidateQueries({ queryKey: savedViewKeys.list(tenantId, userKey) })
    },
  })
}
