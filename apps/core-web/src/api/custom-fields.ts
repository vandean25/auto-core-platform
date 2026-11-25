import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'
import type { components } from './generated/openapi'
import { fetchJsonWithAuth, throwApiResponseError } from './api-error'
import { fetchWithAuth } from './client'
import { i18n } from '@/lib/i18n'

export type CustomFieldEntity = components['schemas']['CustomFieldEntity']
export type CustomFieldType = components['schemas']['CustomFieldType']
export type CustomFieldDefinition = components['schemas']['CustomFieldDefinitionResponseDto']
export type CreateCustomFieldDefinitionPayload = components['schemas']['CreateCustomFieldDefinitionDto']
export type UpdateCustomFieldDefinitionPayload = components['schemas']['UpdateCustomFieldDefinitionDto']
export type ReorderCustomFieldDefinitionsPayload = components['schemas']['ReorderCustomFieldDefinitionsDto']

export const customFieldKeys = {
  all: ['custom-fields'] as const,
  definitions: (entity?: CustomFieldEntity, includeArchived = false) =>
    [...customFieldKeys.all, 'definitions', entity ?? 'ALL', includeArchived] as const,
}

export function useCustomFieldDefinitions(
  entity?: CustomFieldEntity,
  options?: { includeArchived?: boolean; enabled?: boolean },
) {
  const includeArchived = options?.includeArchived ?? false
  const enabled = options?.enabled ?? true
  return useQuery<CustomFieldDefinition[]>({
    queryKey: customFieldKeys.definitions(entity, includeArchived),
    enabled,
    queryFn: async ({ signal }) => {
      const params = new URLSearchParams()
      if (entity) params.set('entity', entity)
      if (includeArchived) params.set('includeArchived', 'true')
      const qs = params.toString()
      return fetchJsonWithAuth<CustomFieldDefinition[]>(
        `/api/custom-fields/definitions${qs ? `?${qs}` : ''}`,
        i18n.t('settings:customFields.loadFailed'),
        { signal },
      )
    },
  })
}

export function useCreateCustomFieldDefinition() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['custom-field', 'create'],
    mutationFn: (payload: CreateCustomFieldDefinitionPayload) =>
      fetchJsonWithAuth<CustomFieldDefinition>(
        '/api/custom-fields/definitions',
        i18n.t('settings:customFields.saveFailed'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customFieldKeys.all })
    },
  })
}

export function useUpdateCustomFieldDefinition() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['custom-field', 'update'],
    mutationFn: ({
      id,
      data,
    }: {
      id: string
      data: UpdateCustomFieldDefinitionPayload
    }) =>
      fetchJsonWithAuth<CustomFieldDefinition>(
        `/api/custom-fields/definitions/${id}`,
        i18n.t('settings:customFields.saveFailed'),
        {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(data),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customFieldKeys.all })
    },
  })
}

export function useReorderCustomFieldDefinitions() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationKey: ['custom-field', 'reorder'],
    mutationFn: (payload: ReorderCustomFieldDefinitionsPayload) =>
      fetchJsonWithAuth<CustomFieldDefinition[]>(
        '/api/custom-fields/definitions/reorder',
        i18n.t('settings:customFields.saveFailed'),
        {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify(payload),
        },
      ),
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: customFieldKeys.all })
    },
  })
}

export async function downloadCustomFieldsCatalogueCsv(): Promise<Blob> {
  const response = await fetchWithAuth('/api/custom-fields/definitions/export', {
    headers: { Accept: 'text/csv' },
  })
  if (!response.ok) {
    return throwApiResponseError(
      response,
      i18n.t('settings:customFields.exportFailed'),
    )
  }
  return response.blob()
}
