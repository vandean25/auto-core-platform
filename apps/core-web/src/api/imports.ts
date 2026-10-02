import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'

export type ImportEntityType = components['schemas']['ImportEntityType']
export type ImportJob = components['schemas']['ImportJobResponseDto']
export type ImportJobRow = components['schemas']['ImportJobRowDto']
export type ImportTemplate = components['schemas']['ImportTemplateResponseDto']
export type ImportMappingProfile = components['schemas']['ImportMappingProfileResponseDto']

export type ImportWizardOptions = {
  update_existing?: boolean
  fill_empty_only?: boolean
  allow_missing_vin?: boolean
  invalid_vat_as_error?: boolean
}

export const importKeys = {
  all: ['imports'] as const,
  template: (entityType: ImportEntityType) =>
    [...importKeys.all, 'template', entityType] as const,
  job: (id: string) => [...importKeys.all, 'job', id] as const,
  rows: (id: string, params?: Record<string, string | undefined>) =>
    [...importKeys.all, 'rows', id, params] as const,
  profiles: (entityType: ImportEntityType, sourceSystem: string) =>
    [...importKeys.all, 'profiles', entityType, sourceSystem] as const,
}

async function readErrorMessage(response: Response, fallback: string) {
  const payload = (await response.json().catch(() => undefined)) as
    | { message?: string }
    | undefined
  return payload?.message ?? fallback
}

export function useImportTemplate(entityType: ImportEntityType | null) {
  return useQuery({
    queryKey: entityType ? importKeys.template(entityType) : ['imports', 'template', 'none'],
    enabled: Boolean(entityType),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/imports/templates/${entityType}`)
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to load import template'))
      }
      return response.json() as Promise<ImportTemplate>
    },
  })
}

export function useImportMappingProfiles(
  entityType: ImportEntityType | null,
  sourceSystem: string,
) {
  const trimmed = sourceSystem.trim()
  return useQuery({
    queryKey: importKeys.profiles(entityType ?? 'CUSTOMER', trimmed),
    enabled: Boolean(entityType && trimmed),
    queryFn: async () => {
      const params = new URLSearchParams({
        entityType: entityType ?? 'CUSTOMER',
        sourceSystem: trimmed,
      })
      const response = await fetchWithAuth(`/api/imports/mapping-profiles?${params}`)
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to load mapping profiles'))
      }
      const body = (await response.json()) as { data: ImportMappingProfile[] }
      return body.data
    },
  })
}

export function useCreateImportMappingProfile() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: {
      entity_type: ImportEntityType
      source_system: string
      name: string
      mapping: Record<string, string>
    }) => {
      const response = await fetchWithAuth('/api/imports/mapping-profiles', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to save mapping profile'))
      }
      return response.json() as Promise<ImportMappingProfile>
    },
    onSuccess: (profile) => {
      void queryClient.invalidateQueries({
        queryKey: importKeys.profiles(profile.entity_type, profile.source_system),
      })
    },
  })
}

export function useImportDryRun() {
  return useMutation({
    mutationFn: async (payload: {
      file: File
      entityType: ImportEntityType
      sourceSystem: string
      mapping: Record<string, string>
      options: ImportWizardOptions
    }) => {
      const form = new FormData()
      form.append('file', payload.file)
      form.append('entityType', payload.entityType)
      form.append('sourceSystem', payload.sourceSystem)
      form.append('mapping', JSON.stringify(payload.mapping))
      form.append('options', JSON.stringify(payload.options))

      const response = await fetchWithAuth('/api/imports', {
        method: 'POST',
        body: form,
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Import dry-run failed'))
      }
      return response.json() as Promise<ImportJob>
    },
  })
}

export function useImportJobRows(
  jobId: string | null,
  options?: { action?: string; hasErrors?: boolean; limit?: number },
) {
  const params: Record<string, string | undefined> = {
    limit: String(options?.limit ?? 500),
    page: '1',
    action: options?.action,
    hasErrors: options?.hasErrors ? 'true' : undefined,
  }

  return useQuery({
    queryKey: importKeys.rows(jobId ?? 'none', params),
    enabled: Boolean(jobId),
    queryFn: async () => {
      const search = new URLSearchParams()
      for (const [key, value] of Object.entries(params)) {
        if (value) search.set(key, value)
      }
      const response = await fetchWithAuth(`/api/imports/${jobId}/rows?${search}`)
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to load import rows'))
      }
      const body = (await response.json()) as { data: ImportJobRow[] }
      return body.data
    },
  })
}

export function useApplyImportJob() {
  return useMutation({
    mutationFn: async (jobId: string) => {
      const response = await fetchWithAuth(`/api/imports/${jobId}/apply`, {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to apply import'))
      }
      return response.json() as Promise<ImportJob>
    },
  })
}

export async function downloadImportTemplateCsv(entityType: ImportEntityType): Promise<Blob> {
  const response = await fetchWithAuth(`/api/imports/templates/${entityType}/csv`, {
    headers: { Accept: 'text/csv' },
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to download template'))
  }
  return response.blob()
}

export async function downloadImportErrorRowsCsv(jobId: string): Promise<Blob> {
  const response = await fetchWithAuth(`/api/imports/${jobId}/errors.csv`, {
    headers: { Accept: 'text/csv' },
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to download error rows'))
  }
  return response.blob()
}
