import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query'

import type { components } from './generated/openapi'
import { fetchWithAuth } from './client'

export type ImportEntityType =
  | components['schemas']['ImportEntityType']
  | 'SUPPLIER_PRICE_LIST'
export type ImportJobStatus = components['schemas']['ImportJobStatus']
export type ImportJob = components['schemas']['ImportJobResponseDto']
export type ImportJobListItem = components['schemas']['ImportJobListItemDto']
export type ImportJobListMeta = components['schemas']['ImportJobListMetaDto']
export type ImportJobRow = components['schemas']['ImportJobRowDto']
export type ImportTemplate = components['schemas']['ImportTemplateResponseDto']
export type ImportMappingProfile = components['schemas']['ImportMappingProfileResponseDto']
export type ImportEntityTypeEntry = components['schemas']['ImportEntityTypeResponseDto']
export type ImportUndoPreviewResponse = components['schemas']['ImportUndoPreviewResponseDto']
export type ImportUndoRowPreview = components['schemas']['ImportUndoRowPreviewDto']
export type UndoImportJobPayload = components['schemas']['UndoImportJobDto']

export type ImportJobRowsMeta = {
  total: number
  page: number
  limit: number
}

export type ImportJobRowsResult = {
  data: ImportJobRow[]
  meta: ImportJobRowsMeta
}

export type ImportWizardOptions = {
  update_existing?: boolean
  fill_empty_only?: boolean
  allow_missing_vin?: boolean
  invalid_vat_as_error?: boolean
  create_new_catalog_items?: boolean
  accept_all_price_jumps?: boolean
  accepted_row_numbers?: number[]
  price_jump_threshold_percent?: number
  vendor_id?: string
}

export const IMPORT_ROWS_PAGE_LIMIT = 200

export const IMPORT_JOBS_PAGE_LIMIT = 20

export type ImportJobListFilters = {
  page?: number
  limit?: number
  status?: ImportJobStatus
  entityType?: ImportEntityType
  source?: string
}

export type ImportJobListResult = {
  data: ImportJobListItem[]
  meta: ImportJobListMeta
}

export const importKeys = {
  all: ['imports'] as const,
  jobs: (params?: Record<string, string | undefined>) =>
    [...importKeys.all, 'jobs', params] as const,
  entityTypes: () => [...importKeys.all, 'entity-types'] as const,
  template: (entityType: ImportEntityType) =>
    [...importKeys.all, 'template', entityType] as const,
  job: (id: string) => [...importKeys.all, 'job', id] as const,
  rows: (id: string, params?: Record<string, string | undefined>) =>
    [...importKeys.all, 'rows', id, params] as const,
  profiles: (entityType: ImportEntityType, sourceSystem: string) =>
    [...importKeys.all, 'profiles', entityType, sourceSystem] as const,
  sources: () => [...importKeys.all, 'sources'] as const,
  undoPreview: (id: string) => [...importKeys.all, 'undo-preview', id] as const,
}

export const importJobKeys = importKeys

export type ImportSource = {
  id: string
  key: string
  label: string
  is_default: boolean
  created_at: string
  updated_at: string
}

export type ImportSourceListResponse = {
  data: ImportSource[]
}

export type CreateImportSourcePayload = {
  key: string
  label: string
  is_default?: boolean
}

export type UpdateImportSourcePayload = {
  label?: string
  is_default?: boolean
}

async function readErrorPayload(response: Response): Promise<{
  message?: string
  code?: string
  leaseExpiresAt?: string | null
} | undefined> {
  return (await response.json().catch(() => undefined)) as
    | { message?: string; code?: string; leaseExpiresAt?: string | null }
    | undefined
}

async function readErrorMessage(response: Response, fallback: string) {
  const payload = await readErrorPayload(response)
  return payload?.message ?? fallback
}

async function throwImportResponseError(response: Response, fallback: string): Promise<never> {
  const payload = await readErrorPayload(response)
  const error = new Error(payload?.message ?? fallback) as Error & {
    response?: { status: number; data?: typeof payload }
  }
  error.response = { status: response.status, data: payload }
  throw error
}

export type DirectImportUploadStart = {
  upload_id: string
  upload_url: string
  method: 'POST'
  headers: Record<string, string>
  content_type: string
  max_bytes: number
  expires_at: string
}

export type DirectImportUploadFinalizePayload = {
  fileName: string
  size: number
  entityType: ImportEntityType
  sourceSystem: string
  mapping: Record<string, string>
  options: ImportWizardOptions
}

export async function startDirectImportUpload(params: {
  fileName: string
  size: number
  contentType: string
}): Promise<DirectImportUploadStart> {
  const response = await fetchWithAuth('/api/imports/direct-uploads', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(params),
  })
  if (!response.ok) {
    return throwImportResponseError(response, 'Failed to start direct import upload')
  }
  return response.json() as Promise<DirectImportUploadStart>
}

export async function finalizeDirectImportUpload(
  uploadId: string,
  payload: DirectImportUploadFinalizePayload,
): Promise<ImportJob> {
  const response = await fetchWithAuth(
    `/api/imports/direct-uploads/${encodeURIComponent(uploadId)}/finalize`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    },
  )
  if (!response.ok) {
    return throwImportResponseError(response, 'Import dry-run failed')
  }
  return response.json() as Promise<ImportJob>
}

function applyJobId(payload: ApplyImportJobPayload): string {
  return typeof payload === 'string' ? payload : payload.jobId
}

function applyRequestInit(payload: ApplyImportJobPayload): RequestInit {
  const options = typeof payload === 'string' ? undefined : payload.options
  return {
    method: 'POST',
    headers: options ? { 'Content-Type': 'application/json' } : undefined,
    body: options ? JSON.stringify(options) : undefined,
  }
}

function toImportQueryString(params: Record<string, string | undefined>): string {
  const search = new URLSearchParams()
  for (const [key, value] of Object.entries(params)) {
    if (value) search.set(key, value)
  }
  return search.toString()
}

export function useImportJobs(filters: ImportJobListFilters = {}) {
  const page = filters.page ?? 1
  const limit = filters.limit ?? IMPORT_JOBS_PAGE_LIMIT
  const params: Record<string, string | undefined> = {
    page: String(page),
    limit: String(limit),
    status: filters.status,
    entityType: filters.entityType,
    source: filters.source?.trim() || undefined,
  }
  return useQuery({
    queryKey: importKeys.jobs(params),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/imports?${toImportQueryString(params)}`)
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to load import history'))
      }
      return response.json() as Promise<ImportJobListResult>
    },
  })
}

export function useImportEntityTypes() {
  return useQuery({
    queryKey: importKeys.entityTypes(),
    staleTime: Infinity,
    queryFn: async () => {
      const response = await fetchWithAuth('/api/imports/entity-types')
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to load import entity types'))
      }
      const body = (await response.json()) as { data: ImportEntityTypeEntry[] }
      return body.data
    },
  })
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
        return throwImportResponseError(response, 'Import dry-run failed')
      }
      return response.json() as Promise<ImportJob>
    },
  })
}

export function useImportJobRows(
  jobId: string | null,
  options?: {
    page?: number
    limit?: number
    action?: 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR'
    hasErrors?: boolean
  },
) {
  const limit = Math.min(IMPORT_ROWS_PAGE_LIMIT, options?.limit ?? IMPORT_ROWS_PAGE_LIMIT)
  const page = options?.page ?? 1
  const params: Record<string, string | undefined> = {
    limit: String(limit),
    page: String(page),
    action: options?.action,
    hasErrors: options?.hasErrors ? 'true' : undefined,
  }

  return useQuery({
    queryKey: importKeys.rows(jobId ?? 'none', params),
    enabled: Boolean(jobId),
    queryFn: async () => {
      const response = await fetchWithAuth(`/api/imports/${jobId}/rows?${toImportQueryString(params)}`)
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to load import rows'))
      }
      const body = (await response.json()) as ImportJobRowsResult
      return body
    },
  })
}

export type ApplyImportJobPayload =
  | string
  | {
      jobId: string
      options?: {
        accept_all_price_jumps?: boolean
        accepted_row_numbers?: number[]
      }
    }

export function useCancelImportJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (jobId: string) => {
      const response = await fetchWithAuth(`/api/imports/${jobId}/cancel`, {
        method: 'POST',
      })
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to cancel import'))
      }
      return response.json() as Promise<ImportJob>
    },
    onSuccess: (job) => {
      void queryClient.invalidateQueries({ queryKey: importKeys.job(job.id) })
      void queryClient.invalidateQueries({ queryKey: importKeys.all })
    },
  })
}

export function useApplyImportJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: ApplyImportJobPayload) => {
      const response = await fetchWithAuth(
        `/api/imports/${applyJobId(payload)}/apply`,
        applyRequestInit(payload),
      )
      if (!response.ok) {
        return throwImportResponseError(response, 'Failed to apply import')
      }
      return response.json() as Promise<ImportJob>
    },
    onSuccess: (job) => {
      queryClient.setQueryData(importKeys.job(job.id), job)
      void queryClient.invalidateQueries({ queryKey: importKeys.job(job.id) })
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

export async function downloadImportErrorRowsCsv(jobId: string, language?: string): Promise<Blob> {
  const csvLanguage = language?.trim().toLowerCase().split('-')[0] === 'en' ? 'en' : 'de'
  const response = await fetchWithAuth(`/api/imports/${jobId}/errors.csv`, {
    headers: { Accept: 'text/csv', 'Accept-Language': csvLanguage },
  })
  if (!response.ok) {
    throw new Error(await readErrorMessage(response, 'Failed to download error rows'))
  }
  return response.blob()
}

export function useImportSources() {
  return useQuery({
    queryKey: importKeys.sources(),
    queryFn: async (): Promise<ImportSourceListResponse> => {
      const response = await fetchWithAuth('/api/imports/sources')
      if (!response.ok) {
        throw new Error(await readErrorMessage(response, 'Failed to load import sources'))
      }
      return response.json() as Promise<ImportSourceListResponse>
    },
  })
}

export function useCreateImportSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (payload: CreateImportSourcePayload): Promise<ImportSource> => {
      const response = await fetchWithAuth('/api/imports/sources', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload),
      })
      if (!response.ok) {
        return throwImportResponseError(response, 'Failed to create import source')
      }
      return response.json() as Promise<ImportSource>
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: importKeys.sources() })
    },
  })
}

export function useUpdateImportSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (params: {
      id: string
      payload: UpdateImportSourcePayload
    }): Promise<ImportSource> => {
      const response = await fetchWithAuth(`/api/imports/sources/${params.id}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(params.payload),
      })
      if (!response.ok) {
        return throwImportResponseError(response, 'Failed to update import source')
      }
      return response.json() as Promise<ImportSource>
    },
    onSuccess: () => {
      void queryClient.invalidateQueries({ queryKey: importKeys.sources() })
    },
  })
}

export function useDeleteImportSource() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async (id: string): Promise<void> => {
      const response = await fetchWithAuth(`/api/imports/sources/${id}`, {
        method: 'DELETE',
      })
      if (!response.ok) {
        return throwImportResponseError(response, 'Failed to delete import source')
      }
    },
    onSuccess: (_data, id) => {
      queryClient.setQueryData<ImportSourceListResponse | undefined>(
        importKeys.sources(),
        (current) => {
          if (!current) return current
          return {
            ...current,
            data: current.data.filter((source) => source.id !== id),
          }
        },
      )
      void queryClient.invalidateQueries({ queryKey: importKeys.sources() })
    },
  })
}

export function useImportUndoPreview(jobId: string | null, enabled = true) {
  return useQuery({
    queryKey: jobId ? importKeys.undoPreview(jobId) : (['imports', 'undo-preview', 'none'] as const),
    queryFn: async (): Promise<ImportUndoPreviewResponse> => {
      if (!jobId) throw new Error('Missing job ID')
      const response = await fetchWithAuth(`/api/imports/${jobId}/undo/preview`, {
        method: 'POST',
      })
      if (!response.ok) {
        return throwImportResponseError(response, 'Failed to load undo preview')
      }
      return response.json() as Promise<ImportUndoPreviewResponse>
    },
    enabled: Boolean(jobId) && enabled,
    staleTime: 0,
  })
}

export function useUndoImportJob() {
  const queryClient = useQueryClient()
  return useMutation({
    mutationFn: async ({
      jobId,
      payload,
    }: {
      jobId: string
      payload?: UndoImportJobPayload
    }): Promise<ImportJob> => {
      const response = await fetchWithAuth(`/api/imports/${jobId}/undo`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: payload ? JSON.stringify(payload) : undefined,
      })
      if (!response.ok) {
        return throwImportResponseError(response, 'Failed to undo import')
      }
      return response.json() as Promise<ImportJob>
    },
    onSuccess: (data) => {
      void queryClient.invalidateQueries({ queryKey: importKeys.all })
      queryClient.setQueryData(importKeys.job(data.id), data)
    },
  })
}
