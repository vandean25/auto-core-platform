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

/** GCS acknowledges committed bytes as `Range: bytes=0-N`; next offset is N+1. */
function parseAcknowledgedBytes(rangeHeader: string | null): number {
  const match = rangeHeader ? /(\d+)-(\d+)$/.exec(rangeHeader.trim()) : null
  if (!match) {
    return 0
  }
  const lastByte = Number(match[2])
  return Number.isFinite(lastByte) ? lastByte + 1 : 0
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
    return parseAcknowledgedBytes(response.headers.get('Range'))
  }
  return 0
}

type ChunkUploadOutcome =
  | { status: 'done' }
  | { status: 'more'; acknowledgedBytes: number }

function isRetryableError(error: unknown): boolean {
  const status = (error as { status?: number }).status
  return status === undefined || isRetryableStatus(status)
}

function assertAcknowledgedWithinFile(acknowledgedBytes: number, totalBytes: number): void {
  if (acknowledgedBytes > totalBytes) {
    throw new Error('Resumable upload acknowledged more bytes than the file size')
  }
  if (acknowledgedBytes >= totalBytes) {
    throw new Error('Resumable upload reported completion without a final response')
  }
}

async function putChunk(params: {
  location: string
  contentType: string
  chunk: Blob
  start: number
  totalBytes: number
}): Promise<ChunkUploadOutcome> {
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
    return { status: 'done' }
  }
  if (response.status === 308) {
    return {
      status: 'more',
      acknowledgedBytes: parseAcknowledgedBytes(response.headers.get('Range')),
    }
  }
  const error = new Error(`Chunk upload failed (${response.status})`) as Error & {
    status?: number
  }
  error.status = response.status
  throw error
}

function applyChunkAcknowledgment(params: {
  acknowledgedBytes: number
  offset: number
  totalBytes: number
  stalledAttempts: number
}): { offset: number; stalledAttempts: number } {
  assertAcknowledgedWithinFile(params.acknowledgedBytes, params.totalBytes)
  if (params.acknowledgedBytes <= params.offset) {
    const stalledAttempts = params.stalledAttempts + 1
    if (stalledAttempts > DIRECT_UPLOAD_MAX_ATTEMPTS) {
      throw new Error('Resumable upload made no progress')
    }
    return { offset: params.offset, stalledAttempts }
  }
  return { offset: params.acknowledgedBytes, stalledAttempts: 0 }
}

async function recoverFromChunkFailure(params: {
  error: unknown
  location: string
  totalBytes: number
  failedAttempts: number
  onProgress?: DirectUploadProgress
}): Promise<{ offset: number; failedAttempts: number }> {
  if (!isRetryableError(params.error)) {
    throw params.error
  }
  const failedAttempts = params.failedAttempts + 1
  if (failedAttempts > DIRECT_UPLOAD_MAX_ATTEMPTS) {
    throw params.error
  }
  const offset = await resolveCommittedOffset(params.location, params.totalBytes)
  params.onProgress?.(offset, params.totalBytes)
  return { offset, failedAttempts }
}

async function uploadFileInChunks(params: {
  location: string
  file: File
  contentType: string
  onProgress?: DirectUploadProgress
}): Promise<void> {
  const totalBytes = params.file.size
  let offset = 0
  let failedAttempts = 0
  let stalledAttempts = 0

  while (offset < totalBytes) {
    const end = Math.min(offset + DIRECT_UPLOAD_CHUNK_BYTES, totalBytes)
    let outcome: ChunkUploadOutcome
    try {
      outcome = await putChunk({
        location: params.location,
        contentType: params.contentType,
        chunk: params.file.slice(offset, end),
        start: offset,
        totalBytes,
      })
    } catch (error) {
      const recovered = await recoverFromChunkFailure({
        error,
        location: params.location,
        totalBytes,
        failedAttempts,
        onProgress: params.onProgress,
      })
      failedAttempts = recovered.failedAttempts
      offset = recovered.offset
      continue
    }
    failedAttempts = 0
    if (outcome.status === 'done') {
      params.onProgress?.(totalBytes, totalBytes)
      return
    }
    const acknowledged = outcome.acknowledgedBytes
    const advanced = applyChunkAcknowledgment({
      acknowledgedBytes: acknowledged,
      offset,
      totalBytes,
      stalledAttempts,
    })
    stalledAttempts = advanced.stalledAttempts
    if (advanced.offset !== offset) {
      offset = advanced.offset
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
