import type { components } from '@/api/generated/openapi'

export type ImportJob = components['schemas']['ImportJobResponseDto']
export type ImportJobRow = components['schemas']['ImportJobRowDto']

export type ImportWizardOptions = {
  update_existing: boolean
  fill_empty_only: boolean
  allow_missing_vin: boolean
  invalid_vat_as_error: boolean
}

export const DEFAULT_IMPORT_OPTIONS: ImportWizardOptions = {
  update_existing: false,
  fill_empty_only: false,
  allow_missing_vin: false,
  invalid_vat_as_error: false,
}

export function isDryRunStale(params: {
  dryRunJob: ImportJob | null
  mapping: Record<string, string>
  options: ImportWizardOptions
  fileFingerprint: string | null
}): boolean {
  if (!params.dryRunJob) return false
  if (!params.fileFingerprint) return true
  if (params.dryRunJob.file_sha256 !== params.fileFingerprint) return true

  const jobMapping = params.dryRunJob.mapping ?? {}
  const keys = new Set([...Object.keys(jobMapping), ...Object.keys(params.mapping)])
  for (const key of keys) {
    if ((jobMapping[key] ?? '') !== (params.mapping[key] ?? '')) {
      return true
    }
  }

  const jobOptions = params.dryRunJob.options as ImportWizardOptions
  return (
    Boolean(jobOptions.update_existing) !== params.options.update_existing ||
    Boolean(jobOptions.fill_empty_only) !== params.options.fill_empty_only ||
    Boolean(jobOptions.allow_missing_vin) !== params.options.allow_missing_vin ||
    Boolean(jobOptions.invalid_vat_as_error) !== params.options.invalid_vat_as_error
  )
}

export function canApplyImport(params: {
  dryRunJob: ImportJob | null
  dryRunStale: boolean
  errorThreshold: number
  isApplying: boolean
}): boolean {
  if (!params.dryRunJob || params.dryRunStale || params.isApplying) return false
  if (params.dryRunJob.status !== 'DRY_RUN_DONE') return false
  const errors = params.dryRunJob.totals?.error ?? 0
  return errors <= params.errorThreshold
}

export type ImportRowFilter = 'ALL' | 'ERROR' | 'CREATE' | 'UPDATE' | 'SKIP'

export function importRowQueryFromFilter(filter: ImportRowFilter): {
  action?: 'CREATE' | 'UPDATE' | 'SKIP' | 'ERROR'
  hasErrors: boolean
} {
  if (filter === 'ERROR') {
    return { hasErrors: true }
  }
  if (filter === 'ALL') {
    return { hasErrors: false }
  }
  return { action: filter, hasErrors: false }
}
