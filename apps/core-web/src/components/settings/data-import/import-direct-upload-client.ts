import {
  finalizeDirectImportUpload,
  startDirectImportUpload,
  type DirectImportUploadStart,
  type ImportEntityType,
  type ImportJob,
} from '@/api/imports'

import type { ImportWizardOptions } from './import-wizard-logic'

export const DIRECT_UPLOAD_CHUNK_BYTES = 8 * 1024 * 1024
const DIRECT_UPLOAD_MAX_ATTEMPTS = 3

export type DirectUploadProgress = (uploadedBytes: number, totalBytes: number) => void

function isRetryableStatus(status: number): boolean {
  return status === 429 || status >= 500
}

async function beginResumableSession(start: DirectImportUploadStart): Promise<string> {
  const response = await fetch(start.upload_url, {
    method: start.method,
    headers: start.headers,
  })
  if (response.status !== 201) {
    throw new Error(`Resumable upload could not be started (${response.status})`)
  }
  const location = response.headers.get('Location')
  if (!location) {
    throw new Error('Resumable upload session has no Location header')
  }
  return location
}

async function resolveCommittedOffset(location: string, totalBytes: number): Promise<number> {
  const response = await fetch(location, {
    method: 'PUT',
    headers: { 'Content-Range': `bytes */${totalBytes}` },
  })
  if (response.status === 200 || response.status === 201) {
    return totalBytes
  }
  if (response.status === 308) {
    const range = response.headers.get('Range')
    const lastByte = range ? Number(range.split('-')[1]) : Number.NaN
    return Number.isFinite(lastByte) ? lastByte + 1 : 0
  }
  return 0
}

async function putChunk(params: {
  location: string
  contentType: string
  chunk: Blob
  start: number
  totalBytes: number
}): Promise<'done' | 'more'> {
  const end = params.start + params.chunk.size - 1
  const response = await fetch(params.location, {
    method: 'PUT',
    headers: {
      'Content-Type': params.contentType,
      'Content-Range': `bytes ${params.start}-${end}/${params.totalBytes}`,
    },
    body: params.chunk,
  })
  if (response.status === 200 || response.status === 201) {
    return 'done'
  }
  if (response.status === 308) {
    return 'more'
  }
  const error = new Error(`Chunk upload failed (${response.status})`) as Error & {
    status?: number
  }
  error.status = response.status
  throw error
}

async function uploadFileInChunks(params: {
  location: string
  file: File
  contentType: string
  onProgress?: DirectUploadProgress
}): Promise<void> {
  const totalBytes = params.file.size
  let offset = 0
  let attempt = 0

  while (offset < totalBytes) {
    const end = Math.min(offset + DIRECT_UPLOAD_CHUNK_BYTES, totalBytes)
    try {
      const outcome = await putChunk({
        location: params.location,
        contentType: params.contentType,
        chunk: params.file.slice(offset, end),
        start: offset,
        totalBytes,
      })
      offset = outcome === 'done' ? totalBytes : end
      attempt = 0
      params.onProgress?.(offset, totalBytes)
    } catch (error) {
      const status = (error as { status?: number }).status
      if (status !== undefined && !isRetryableStatus(status)) {
        throw error
      }
      attempt += 1
      if (attempt > DIRECT_UPLOAD_MAX_ATTEMPTS) {
        throw error
      }
      offset = await resolveCommittedOffset(params.location, totalBytes)
      params.onProgress?.(offset, totalBytes)
    }
  }
}

/** Uploads a large CSV straight to GCS, then starts the normal background dry-run. */
export async function uploadImportFileDirectly(params: {
  file: File
  entityType: ImportEntityType
  sourceSystem: string
  mapping: Record<string, string>
  options: ImportWizardOptions
  onProgress?: DirectUploadProgress
}): Promise<ImportJob> {
  const start = await startDirectImportUpload({
    fileName: params.file.name,
    size: params.file.size,
    contentType: params.file.type || 'text/csv',
  })
  const location = await beginResumableSession(start)
  await uploadFileInChunks({
    location,
    file: params.file,
    contentType: start.content_type,
    onProgress: params.onProgress,
  })
  return finalizeDirectImportUpload(start.upload_id, {
    fileName: params.file.name,
    size: params.file.size,
    entityType: params.entityType,
    sourceSystem: params.sourceSystem,
    mapping: params.mapping,
    options: params.options,
  })
}
