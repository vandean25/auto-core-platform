import * as React from 'react'

import type { ImportJob } from '@/api/imports'

import {
  getImportFieldsForEntity,
  type ImportEntityTypeUi,
  type ImportFieldDefinition,
} from './import-field-labels'
import { validateRequiredMappings } from './import-mapping-suggest'
import {
  DEFAULT_IMPORT_OPTIONS,
  isDryRunStale,
  type ImportRowFilter,
  type ImportWizardOptions,
} from './import-wizard-logic'

export type ImportCsvSelection = {
  file: File | null
  headers: string[]
  previewRows: string[][]
  fingerprint: string | null
  mapping: Record<string, string>
}

export const EMPTY_CSV_SELECTION: ImportCsvSelection = {
  file: null,
  headers: [],
  previewRows: [],
  fingerprint: null,
  mapping: {},
}

export type ImportWizardState = {
  step: number
  setStep: (step: number) => void
  entityType: ImportEntityTypeUi
  setEntityType: (entityType: ImportEntityTypeUi) => void
  selectedVendorId: string
  setSelectedVendorId: (vendorId: string) => void
  clearVendorSelection: () => void
  file: File | null
  setFile: (file: File | null) => void
  csvHeaders: string[]
  previewRows: string[][]
  fileFingerprint: string | null
  mapping: Record<string, string>
  setMapping: React.Dispatch<React.SetStateAction<Record<string, string>>>
  resetMapping: () => void
  options: ImportWizardOptions
  setOptions: React.Dispatch<React.SetStateAction<ImportWizardOptions>>
  updateOptions: (patch: Partial<ImportWizardOptions>) => void
  updateOptionsKeepingDryRun: (patch: Partial<ImportWizardOptions>) => void
  errorThreshold: number
  setErrorThreshold: (value: number) => void
  rowFilter: ImportRowFilter
  setRowFilter: (filter: ImportRowFilter) => void
  rowsPage: number
  setRowsPage: (page: number) => void
  dryRunJob: ImportJob | null
  appliedJob: ImportJob | null
  setDryRunJob: (job: ImportJob | null) => void
  setAppliedJob: (job: ImportJob | null) => void
  profileName: string
  setProfileName: (name: string) => void
  acceptAllPriceJumps: boolean
  setAcceptAllPriceJumps: React.Dispatch<React.SetStateAction<boolean>>
  acceptedRowNumbers: number[]
  fields: ImportFieldDefinition[]
  missingRequired: string[]
  dryRunStale: boolean
  resetDryRun: () => void
  toggleRowAcceptance: (rowNo: number, accepted: boolean) => void
  applyCsvSelection: (selection: ImportCsvSelection) => void
  applyDryRunResult: (job: ImportJob) => void
  applyAppliedResult: (job: ImportJob) => void
}

/**
 * Owns the pure client-side state of the import wizard: step, entity, file,
 * mapping, options and the dry-run/apply results.
 */
export function useImportWizardState(params: {
  initialEntityType: ImportEntityTypeUi
  initialVendorId?: string
}): ImportWizardState {
  const [step, setStep] = React.useState(1)
  const [entityType, setEntityType] = React.useState<ImportEntityTypeUi>(params.initialEntityType)
  const [selectedVendorId, setSelectedVendorId] = React.useState<string>(
    params.initialVendorId ?? '',
  )
  const [file, setFile] = React.useState<File | null>(null)
  const [fileFingerprint, setFileFingerprint] = React.useState<string | null>(null)
  const [csvHeaders, setCsvHeaders] = React.useState<string[]>([])
  const [previewRows, setPreviewRows] = React.useState<string[][]>([])
  const [mapping, setMapping] = React.useState<Record<string, string>>({})
  const [options, setOptions] = React.useState<ImportWizardOptions>({
    ...DEFAULT_IMPORT_OPTIONS,
    vendor_id: params.initialVendorId ?? undefined,
  })
  const [errorThreshold, setErrorThreshold] = React.useState(0)
  const [rowFilter, setRowFilter] = React.useState<ImportRowFilter>('ALL')
  const [rowsPage, setRowsPage] = React.useState(1)
  const [dryRunJob, setDryRunJob] = React.useState<ImportJob | null>(null)
  const [appliedJob, setAppliedJob] = React.useState<ImportJob | null>(null)
  const [profileName, setProfileName] = React.useState('')
  const [acceptAllPriceJumps, setAcceptAllPriceJumps] = React.useState(false)
  const [acceptedRowNumbers, setAcceptedRowNumbers] = React.useState<number[]>([])

  const fields = React.useMemo(() => getImportFieldsForEntity(entityType), [entityType])
  const missingRequired = validateRequiredMappings(mapping, fields)
  const dryRunStale = isDryRunStale({ dryRunJob, mapping, options, fileFingerprint })

  React.useEffect(() => {
    setRowsPage(1)
  }, [rowFilter, dryRunJob?.id])

  const resetDryRun = React.useCallback(() => {
    setDryRunJob(null)
    setAppliedJob(null)
    setAcceptAllPriceJumps(false)
    setAcceptedRowNumbers([])
  }, [])

  const resetMapping = React.useCallback(() => {
    setMapping({})
  }, [])

  const clearVendorSelection = React.useCallback(() => {
    setSelectedVendorId('')
    setOptions((prev) => ({ ...prev, vendor_id: undefined }))
  }, [])

  const updateOptions = React.useCallback(
    (patch: Partial<ImportWizardOptions>) => {
      setOptions((prev) => ({ ...prev, ...patch }))
      resetDryRun()
    },
    [resetDryRun],
  )

  const updateOptionsKeepingDryRun = React.useCallback((patch: Partial<ImportWizardOptions>) => {
    setOptions((prev) => ({ ...prev, ...patch }))
  }, [])

  const toggleRowAcceptance = React.useCallback((rowNo: number, accepted: boolean) => {
    setAcceptedRowNumbers((prev) =>
      accepted ? [...prev, rowNo] : prev.filter((number) => number !== rowNo),
    )
  }, [])

  const applyCsvSelection = React.useCallback((selection: ImportCsvSelection) => {
    setFile(selection.file)
    setCsvHeaders(selection.headers)
    setPreviewRows(selection.previewRows)
    setFileFingerprint(selection.fingerprint)
    setMapping(selection.mapping)
  }, [])

  const applyDryRunResult = React.useCallback((job: ImportJob) => {
    setDryRunJob(job)
    setFileFingerprint(job.file_sha256)
    setAppliedJob(null)
    setAcceptAllPriceJumps(false)
    setAcceptedRowNumbers([])
    setStep(4)
    setRowFilter('ALL')
    setRowsPage(1)
  }, [])

  const applyAppliedResult = React.useCallback((job: ImportJob) => {
    setAppliedJob(job)
    setDryRunJob(job)
    setStep(5)
  }, [])

  return {
    step,
    setStep,
    entityType,
    setEntityType,
    selectedVendorId,
    setSelectedVendorId,
    clearVendorSelection,
    file,
    setFile,
    csvHeaders,
    previewRows,
    fileFingerprint,
    mapping,
    setMapping,
    resetMapping,
    options,
    setOptions,
    updateOptions,
    updateOptionsKeepingDryRun,
    errorThreshold,
    setErrorThreshold,
    rowFilter,
    setRowFilter,
    rowsPage,
    setRowsPage,
    dryRunJob,
    appliedJob,
    setDryRunJob,
    setAppliedJob,
    profileName,
    setProfileName,
    acceptAllPriceJumps,
    setAcceptAllPriceJumps,
    acceptedRowNumbers,
    fields,
    missingRequired,
    dryRunStale,
    resetDryRun,
    toggleRowAcceptance,
    applyCsvSelection,
    applyDryRunResult,
    applyAppliedResult,
  }
}
