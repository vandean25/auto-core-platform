import * as React from 'react'
import { useTranslation } from 'react-i18next'
import { Link, useSearchParams } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  Loader2,
  Save,
} from 'lucide-react'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'

import type { ImportEntityType, ImportJob } from '@/api/imports'
import {
  downloadImportErrorRowsCsv,
  downloadImportTemplateCsv,
  IMPORT_ROWS_PAGE_LIMIT,
  useApplyImportJob,
  useCreateImportMappingProfile,
  useImportDryRun,
  useImportJobRows,
  useImportMappingProfiles,
  useImportTemplate,
} from '@/api/imports'
import { laborKeys } from '@/api/labor'
import { usePriceJumpThreshold } from '@/api/margin-rules'
import { useVendors } from '@/api/vendors'
import { formatImportEntityTypeLabel } from '@/lib/i18n/enum-labels'
import { IMPORT_ENTITY_TYPE_VALUES } from '@/lib/i18n/enum-registry'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from '@/components/ui/select'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { triggerBlobDownload } from '@/lib/download'
import { getErrorMessage } from '@/lib/error-utils'
import { formatNumber } from '@/lib/format'
import { cn } from '@/lib/utils'

import {
  formatFieldLabel,
  getImportFieldsForEntity,
  type ImportEntityTypeUi,
} from './import-field-labels'
import {
  constrainMappingToCsvHeaders,
  suggestColumnMapping,
  validateRequiredMappings,
} from './import-mapping-suggest'
import {
  canApplyImport,
  DEFAULT_IMPORT_OPTIONS,
  importRowQueryFromFilter,
  isDryRunStale,
  type ImportRowFilter,
  type ImportWizardOptions,
} from './import-wizard-logic'
import { parseImportCsvFile, sha256HexFromFile } from './parse-import-csv-client'

const WIZARD_STEPS = [
  { id: 1, labelKey: 'dataImport.steps.source' },
  { id: 2, labelKey: 'dataImport.steps.upload' },
  { id: 3, labelKey: 'dataImport.steps.mapping' },
  { id: 4, labelKey: 'dataImport.steps.dryRun' },
  { id: 5, labelKey: 'dataImport.steps.apply' },
] as const

function initialEntityFromParam(param: string | null): ImportEntityTypeUi {
  if (
    param === 'CUSTOMER' ||
    param === 'VEHICLE' ||
    param === 'SUPPLIER_PRICE_LIST' ||
    param === 'LABOR_OPERATION'
  ) {
    return param
  }
  return 'CUSTOMER'
}

export function DataImportSettingsTab() {
  const { t } = useTranslation(['settings', 'common'])
  const queryClient = useQueryClient()
  const [searchParams] = useSearchParams()
  const initialEntityParam = searchParams.get('entity')
  const initialVendorParam = searchParams.get('vendorId')

  const initialEntityType = initialEntityFromParam(initialEntityParam)

  const [step, setStep] = React.useState(1)
  const [entityType, setEntityType] = React.useState<ImportEntityTypeUi>(initialEntityType)
  const [selectedVendorId, setSelectedVendorId] = React.useState<string>(initialVendorParam ?? '')
  const [acceptAllPriceJumps, setAcceptAllPriceJumps] = React.useState(false)
  const [acceptedRowNumbers, setAcceptedRowNumbers] = React.useState<number[]>([])
  const [sourceSystem, setSourceSystem] = React.useState(
    initialEntityType === 'SUPPLIER_PRICE_LIST' ? 'supplier' : 'incadea',
  )
  const [file, setFile] = React.useState<File | null>(null)
  const [fileFingerprint, setFileFingerprint] = React.useState<string | null>(null)
  const [csvHeaders, setCsvHeaders] = React.useState<string[]>([])
  const [previewRows, setPreviewRows] = React.useState<string[][]>([])
  const [mapping, setMapping] = React.useState<Record<string, string>>({})
  const [options, setOptions] = React.useState<ImportWizardOptions>({
    ...DEFAULT_IMPORT_OPTIONS,
    vendor_id: initialVendorParam ?? undefined,
  })
  const [errorThreshold, setErrorThreshold] = React.useState(0)
  const [rowFilter, setRowFilter] = React.useState<ImportRowFilter>('ALL')
  const [rowsPage, setRowsPage] = React.useState(1)
  const [dryRunJob, setDryRunJob] = React.useState<ImportJob | null>(null)
  const [appliedJob, setAppliedJob] = React.useState<ImportJob | null>(null)
  const [profileName, setProfileName] = React.useState('')
  const [confirmApplyOpen, setConfirmApplyOpen] = React.useState(false)
  const [applyInFlight, setApplyInFlight] = React.useState(false)
  const applyInFlightRef = React.useRef(false)

  const { data: vendorsData } = useVendors({ page: 1, pageSize: 100, filters: [] })
  const vendors = vendorsData?.data ?? []

  const thresholdQuery = usePriceJumpThreshold()
  const configuredThreshold =
    thresholdQuery.data?.price_jump_threshold_percent ??
    thresholdQuery.data?.threshold_percent ??
    20

  const isRowPriceJump = React.useCallback(
    (row: { normalized?: unknown; warnings?: unknown }) => {
      const norm = row.normalized as Record<string, unknown> | null
      const warnings = (row.warnings ?? []) as Array<{
        code?: string
        message?: string
      }>
      return (
        norm?.price_jump_flagged === true ||
        warnings.some(
          (w) =>
            w.code === 'PRICE_JUMP_EXCEEDED' ||
            (typeof w.message === 'string' &&
              w.message.toLowerCase().includes('preissprung')),
        )
      )
    },
    [],
  )

  const fields = React.useMemo(() => getImportFieldsForEntity(entityType), [entityType])
  const { data: template } = useImportTemplate(entityType)
  const { data: profiles = [] } = useImportMappingProfiles(entityType, sourceSystem)
  const dryRunMutation = useImportDryRun()
  const applyMutation = useApplyImportJob()
  const saveProfileMutation = useCreateImportMappingProfile()

  const dryRunStale = isDryRunStale({
    dryRunJob,
    mapping,
    options,
    fileFingerprint,
  })

  const missingRequired = validateRequiredMappings(mapping, fields)

  const rowQuery = importRowQueryFromFilter(rowFilter)

  React.useEffect(() => {
    setRowsPage(1)
  }, [rowFilter, dryRunJob?.id])

  const { data: rowsResponse, isLoading: isLoadingRows } = useImportJobRows(
    step >= 4 ? dryRunJob?.id ?? null : null,
    {
      page: rowsPage,
      limit: IMPORT_ROWS_PAGE_LIMIT,
      action: rowQuery.action,
      hasErrors: rowQuery.hasErrors,
    },
  )

  const jobRows = React.useMemo(() => rowsResponse?.data ?? [], [rowsResponse?.data])
  const flaggedJumpCount = React.useMemo(() => {
    const jobTotalFlagged = (dryRunJob?.totals as { flagged_jumps?: number } | undefined)
      ?.flagged_jumps
    if (typeof jobTotalFlagged === 'number') {
      return jobTotalFlagged
    }
    return jobRows.filter(isRowPriceJump).length
  }, [dryRunJob?.totals, jobRows, isRowPriceJump])
  const rowsMeta = rowsResponse?.meta
  const rowsTotalPages = rowsMeta
    ? Math.max(1, Math.ceil(rowsMeta.total / rowsMeta.limit))
    : 1

  const applyEnabled = canApplyImport({
    dryRunJob,
    dryRunStale,
    errorThreshold,
    isApplying: applyMutation.isPending || applyInFlight,
  })

  const resetDryRun = React.useCallback(() => {
    setDryRunJob(null)
    setAppliedJob(null)
    setAcceptAllPriceJumps(false)
    setAcceptedRowNumbers([])
  }, [])

  const handleEntityChange = (value: ImportEntityTypeUi) => {
    setEntityType(value)
    if (value !== 'SUPPLIER_PRICE_LIST') {
      setSelectedVendorId('')
      setOptions((prev) => ({ ...prev, vendor_id: undefined }))
    } else if (sourceSystem === 'incadea') {
      setSourceSystem('supplier')
    }
    setMapping({})
    resetDryRun()
    setStep(1)
  }

  const handleFileSelected = async (selected: File | null) => {
    setFile(selected)
    resetDryRun()
    if (!selected) {
      setCsvHeaders([])
      setPreviewRows([])
      setFileFingerprint(null)
      setMapping({})
      return
    }

    try {
      const parsed = await parseImportCsvFile(selected)
      const fingerprint = await sha256HexFromFile(selected)
      setCsvHeaders(parsed.headers)
      setPreviewRows(parsed.rows.slice(0, 20))
      setFileFingerprint(fingerprint)
      const suggested = suggestColumnMapping(parsed.headers, entityType, fields)
      setMapping(suggested)
    } catch (error) {
      setFile(null)
      setCsvHeaders([])
      setPreviewRows([])
      setFileFingerprint(null)
      setMapping({})
      toast.error(
        getErrorMessage(error, t('dataImport.toast.csvReadFailed')),
      )
    }
  }

  const handleLoadProfile = (profileId: string) => {
    const profile = profiles.find((item) => item.id === profileId)
    if (!profile) return
    setMapping(constrainMappingToCsvHeaders(profile.mapping, csvHeaders))
    resetDryRun()
    toast.success(t('dataImport.toast.profileLoaded'))
  }

  const handleSaveProfile = async () => {
    const name = profileName.trim()
    if (!name) {
      toast.error(t('dataImport.toast.profileNameRequired'))
      return
    }
    try {
      await saveProfileMutation.mutateAsync({
        entity_type: entityType as ImportEntityType,
        source_system: sourceSystem.trim(),
        name,
        mapping,
      })
      toast.success(t('dataImport.toast.profileSaved'))
      setProfileName('')
    } catch (error) {
      toast.error(
        getErrorMessage(error, t('dataImport.toast.profileSaveFailed')),
      )
    }
  }

  const handleRunDryRun = async () => {
    if (!file) {
      toast.error(t('dataImport.toast.selectCsv'))
      return
    }
    if (missingRequired.length > 0) {
      toast.error(t('dataImport.toast.mapRequired'))
      return
    }

    try {
      const effectiveOptions: ImportWizardOptions = {
        ...options,
        ...(entityType === 'SUPPLIER_PRICE_LIST'
          ? { price_jump_threshold_percent: configuredThreshold }
          : {}),
      }
      const job = await dryRunMutation.mutateAsync({
        file,
        entityType: entityType as ImportEntityType,
        sourceSystem: sourceSystem.trim(),
        mapping,
        options: effectiveOptions,
      })
      setDryRunJob(job)
      setFileFingerprint(job.file_sha256)
      setAppliedJob(null)
      setAcceptAllPriceJumps(false)
      setAcceptedRowNumbers([])
      setStep(4)
      setRowFilter('ALL')
      setRowsPage(1)
    } catch (error) {
      toast.error(getErrorMessage(error, t('dataImport.toast.dryRunFailed')))
    }
  }

  const handleApply = async () => {
    if (!dryRunJob || !applyEnabled || applyInFlightRef.current) return
    applyInFlightRef.current = true
    setApplyInFlight(true)
    try {
      const applyPayload =
        entityType === 'SUPPLIER_PRICE_LIST'
          ? {
              jobId: dryRunJob.id,
              options: {
                accept_all_price_jumps: acceptAllPriceJumps,
                accepted_row_numbers: acceptAllPriceJumps
                  ? undefined
                  : acceptedRowNumbers.length > 0
                    ? acceptedRowNumbers
                    : undefined,
              },
            }
          : dryRunJob.id
      const result = await applyMutation.mutateAsync(applyPayload)
      setAppliedJob(result)
      setDryRunJob(result)
      setStep(5)
      setConfirmApplyOpen(false)
      if (entityType === 'LABOR_OPERATION') {
        void queryClient.invalidateQueries({ queryKey: laborKeys.operations() })
        void queryClient.invalidateQueries({ queryKey: laborKeys.categories() })
      }
      toast.success(t('dataImport.toast.applied'))
    } catch (error) {
      toast.error(getErrorMessage(error, t('dataImport.toast.applyFailed')))
    } finally {
      applyInFlightRef.current = false
      setApplyInFlight(false)
    }
  }

  const handleDownloadTemplate = async () => {
    try {
      const blob = await downloadImportTemplateCsv(entityType as ImportEntityType)
      triggerBlobDownload(blob, `${entityType.toLowerCase()}-import-template.csv`)
    } catch (error) {
      toast.error(
        getErrorMessage(error, t('dataImport.toast.templateFailed')),
      )
    }
  }

  const handleDownloadErrors = async () => {
    if (!dryRunJob) return
    try {
      const blob = await downloadImportErrorRowsCsv(dryRunJob.id)
      triggerBlobDownload(blob, `import-${dryRunJob.id}-errors.csv`)
    } catch (error) {
      toast.error(
        getErrorMessage(error, t('dataImport.toast.errorCsvFailed')),
      )
    }
  }

  const auditLogHref = dryRunJob
    ? `/settings?tab=audit-logs&auditEntityType=ImportJob&auditEntityId=${encodeURIComponent(dryRunJob.id)}`
    : '/settings?tab=audit-logs'

  return (
    <div className="space-y-6 p-6 bg-white border rounded-lg shadow-sm">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <h2 className="text-lg font-medium">{t('dataImport.title')}</h2>
          <p className="text-sm text-muted-foreground max-w-2xl">
            {t('dataImport.description')}
          </p>
        </div>
      </div>

      <nav aria-label={t('dataImport.stepsNavAria')} className="flex flex-wrap gap-2">
        {WIZARD_STEPS.map((wizardStep) => (
          <Badge
            key={wizardStep.id}
            variant={step === wizardStep.id ? 'default' : 'outline'}
            className={cn('text-xs', step > wizardStep.id && 'border-green-600 text-green-700')}
          >
            {wizardStep.id}. {t(wizardStep.labelKey)}
          </Badge>
        ))}
      </nav>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle as="h3">{t('dataImport.consent.title')}</AlertTitle>
        <AlertDescription>
          {t('dataImport.consent.description')}
        </AlertDescription>
      </Alert>

      {step === 1 && (
        <section className="space-y-4" aria-labelledby="import-step-source">
          <h4 id="import-step-source" className="font-medium">
            {t('dataImport.source.title')}
          </h4>
          <div className="grid gap-4 md:grid-cols-2 max-w-2xl">
            <div className="space-y-2">
              <Label htmlFor="import-entity">{t('dataImport.source.entityLabel')}</Label>
              <Select
                value={entityType}
                onValueChange={(value) => handleEntityChange(value as ImportEntityTypeUi)}
              >
                <SelectTrigger id="import-entity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  {IMPORT_ENTITY_TYPE_VALUES.map((value) => (
                    <SelectItem key={value} value={value}>
                      {formatImportEntityTypeLabel(value)}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-source">{t('dataImport.source.sourceSystemLabel')}</Label>
              <Input
                id="import-source"
                value={sourceSystem}
                onChange={(event) => {
                  setSourceSystem(event.target.value)
                  resetDryRun()
                }}
              />
            </div>
            {entityType === 'SUPPLIER_PRICE_LIST' ? (
              <div className="space-y-2 md:col-span-2">
                <Label htmlFor="import-vendor">{t('dataImport.source.vendorLabel')}</Label>
                <Select
                  value={selectedVendorId || '__none__'}
                  onValueChange={(value) => {
                    const id = value === '__none__' ? '' : value
                    setSelectedVendorId(id)
                    setOptions((prev) => ({ ...prev, vendor_id: id || undefined }))
                    resetDryRun()
                  }}
                >
                  <SelectTrigger id="import-vendor" aria-label={t('dataImport.source.vendorAria')}>
                    <SelectValue placeholder={t('dataImport.source.vendorPlaceholder')} />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="__none__">{t('dataImport.source.vendorPlaceholder')}</SelectItem>
                    {vendors.map((vendor) => (
                      <SelectItem key={vendor.id} value={vendor.id}>
                        {vendor.name}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
            ) : null}
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void handleDownloadTemplate()}>
              <Download className="mr-2 h-4 w-4" />
              {t('dataImport.source.downloadTemplate')}
            </Button>
            <Button
              type="button"
              disabled={entityType === 'SUPPLIER_PRICE_LIST' && !selectedVendorId}
              onClick={() => setStep(2)}
            >
              {t('dataImport.source.continue')}
            </Button>
          </div>
          {template?.fields?.length ? (
            <p className="text-xs text-muted-foreground">
              {t('dataImport.source.templateFields', {
                fields: template.fields.map((field) => field.key).join(', '),
              })}
            </p>
          ) : null}
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4" aria-labelledby="import-step-upload">
          <h4 id="import-step-upload" className="font-medium">
            {t('dataImport.upload.title')}
          </h4>
          <div className="space-y-2 max-w-lg">
            <Label htmlFor="import-file">{t('dataImport.upload.fileLabel')}</Label>
            <Input
              id="import-file"
              type="file"
              accept=".csv,text/csv"
              onChange={(event) => {
                const selected = event.target.files?.[0] ?? null
                void handleFileSelected(selected)
              }}
            />
            {file ? (
              <p className="text-sm text-muted-foreground flex items-center gap-2">
                <FileUp className="h-4 w-4" />
                {t('dataImport.upload.fileSummary', {
                  name: file.name,
                  columns: formatNumber(csvHeaders.length),
                })}
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(1)}>
              {t('dataImport.upload.back')}
            </Button>
            <Button type="button" disabled={!file} onClick={() => setStep(3)}>
              {t('dataImport.upload.continue')}
            </Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4" aria-labelledby="import-step-mapping">
          <h4 id="import-step-mapping" className="font-medium">
            {t('dataImport.mapping.title')}
          </h4>

          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="space-y-2 flex-1 max-w-xs">
              <Label htmlFor="import-profile-load">{t('dataImport.mapping.savedProfile')}</Label>
              <Select onValueChange={handleLoadProfile}>
                <SelectTrigger id="import-profile-load">
                  <SelectValue placeholder={t('dataImport.mapping.loadProfilePlaceholder')} />
                </SelectTrigger>
                <SelectContent>
                  {profiles.map((profile) => (
                    <SelectItem key={profile.id} value={profile.id}>
                      {profile.name}
                    </SelectItem>
                  ))}
                </SelectContent>
              </Select>
            </div>
            <div className="flex flex-1 gap-2 items-end">
              <div className="space-y-2 flex-1 max-w-xs">
                <Label htmlFor="import-profile-name">{t('dataImport.mapping.saveAs')}</Label>
                <Input
                  id="import-profile-name"
                  value={profileName}
                  onChange={(event) => setProfileName(event.target.value)}
                />
              </div>
              <Button
                type="button"
                variant="secondary"
                disabled={saveProfileMutation.isPending}
                onClick={() => void handleSaveProfile()}
              >
                {saveProfileMutation.isPending ? (
                  <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                ) : (
                  <Save className="mr-2 h-4 w-4" />
                )}
                {t('dataImport.mapping.saveProfile')}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('dataImport.mapping.acpField')}</TableHead>
                  <TableHead>{t('dataImport.mapping.csvColumn')}</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((field) => (
                  <TableRow key={field.key}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{formatFieldLabel(entityType, field)}</span>
                        {field.required ? (
                          <Badge variant="destructive" className="text-[10px]">
                            {t('dataImport.mapping.required')}
                          </Badge>
                        ) : null}
                      </div>
                    </TableCell>
                    <TableCell>
                      <Select
                        value={mapping[field.key] ?? '__none__'}
                        onValueChange={(value) => {
                          setMapping((prev) => ({
                            ...prev,
                            [field.key]: value === '__none__' ? '' : value,
                          }))
                          resetDryRun()
                        }}
                      >
                        <SelectTrigger aria-label={t('dataImport.mapping.mapAria', { field: field.key })}>
                          <SelectValue placeholder="—" />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="__none__">—</SelectItem>
                          {csvHeaders.map((header) => (
                            <SelectItem key={header} value={header}>
                              {header}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>

          {missingRequired.length > 0 ? (
            <p className="text-sm text-destructive" role="alert">
              {t('dataImport.mapping.missingRequired', { fields: missingRequired.join(', ') })}
            </p>
          ) : null}

          <div className="grid gap-3 md:grid-cols-2 max-w-3xl">
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id="import-opt-update-existing"
                checked={options.update_existing}
                onCheckedChange={(checked) => {
                  setOptions((prev) => ({ ...prev, update_existing: checked === true }))
                  resetDryRun()
                }}
              />
              <Label htmlFor="import-opt-update-existing" className="font-normal cursor-pointer">
                {t('dataImport.mapping.options.updateExisting')}
              </Label>
            </div>
            <div className="flex items-center gap-2 text-sm">
              <Checkbox
                id="import-opt-fill-empty"
                checked={options.fill_empty_only}
                onCheckedChange={(checked) => {
                  setOptions((prev) => ({ ...prev, fill_empty_only: checked === true }))
                  resetDryRun()
                }}
              />
              <Label htmlFor="import-opt-fill-empty" className="font-normal cursor-pointer">
                {t('dataImport.mapping.options.fillEmptyOnly')}
              </Label>
            </div>
            {entityType === 'VEHICLE' ? (
              <div className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="import-opt-allow-missing-vin"
                  checked={options.allow_missing_vin}
                  onCheckedChange={(checked) => {
                    setOptions((prev) => ({ ...prev, allow_missing_vin: checked === true }))
                    resetDryRun()
                  }}
                />
                <Label htmlFor="import-opt-allow-missing-vin" className="font-normal cursor-pointer">
                  {t('dataImport.mapping.options.allowMissingVin')}
                </Label>
              </div>
            ) : null}
            {entityType === 'CUSTOMER' ? (
              <div className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="import-opt-invalid-vat-error"
                  checked={options.invalid_vat_as_error}
                  onCheckedChange={(checked) => {
                    setOptions((prev) => ({ ...prev, invalid_vat_as_error: checked === true }))
                    resetDryRun()
                  }}
                />
                <Label htmlFor="import-opt-invalid-vat-error" className="font-normal cursor-pointer">
                  {t('dataImport.mapping.options.invalidVatAsError')}
                </Label>
              </div>
            ) : null}
            {entityType === 'SUPPLIER_PRICE_LIST' ? (
              <div className="flex items-center gap-2 text-sm">
                <Checkbox
                  id="import-opt-create-catalog"
                  checked={options.create_new_catalog_items}
                  onCheckedChange={(checked) => {
                    setOptions((prev) => ({
                      ...prev,
                      create_new_catalog_items: checked === true,
                    }))
                    resetDryRun()
                  }}
                />
                <Label htmlFor="import-opt-create-catalog" className="font-normal cursor-pointer">
                  {t('dataImport.mapping.options.createCatalogItems')}
                </Label>
              </div>
            ) : null}
          </div>

          {previewRows.length > 0 ? (
            <div className="space-y-2">
              <h5 className="text-sm font-medium">{t('dataImport.mapping.previewTitle')}</h5>
              <div className="overflow-x-auto border rounded-md max-h-64">
                <Table>
                  <TableHeader>
                    <TableRow>
                      {csvHeaders.map((header) => (
                        <TableHead key={header} className="whitespace-nowrap text-xs">
                          {header}
                        </TableHead>
                      ))}
                    </TableRow>
                  </TableHeader>
                  <TableBody>
                    {previewRows.map((row, rowIndex) => (
                      <TableRow key={rowIndex}>
                        {csvHeaders.map((_, colIndex) => (
                          <TableCell key={colIndex} className="text-xs whitespace-nowrap">
                            {row[colIndex] ?? ''}
                          </TableCell>
                        ))}
                      </TableRow>
                    ))}
                  </TableBody>
                </Table>
              </div>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(2)}>
              {t('dataImport.mapping.back')}
            </Button>
            <Button
              type="button"
              disabled={!file || missingRequired.length > 0 || dryRunMutation.isPending}
              onClick={() => void handleRunDryRun()}
            >
              {dryRunMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t('dataImport.mapping.runDryRun')}
            </Button>
          </div>
        </section>
      )}

      {step >= 4 && dryRunJob ? (
        <section className="space-y-4" aria-labelledby="import-step-dryrun">
          <h4 id="import-step-dryrun" className="font-medium">
            {t('dataImport.dryRun.title')}
          </h4>

          {dryRunStale ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle as="h5">{t('dataImport.dryRun.stale.title')}</AlertTitle>
              <AlertDescription>
                {t('dataImport.dryRun.stale.description')}
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">
              {t('dataImport.dryRun.totals.rows', { value: formatNumber(dryRunJob.totals.rows) })}
            </Badge>
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
              {t('dataImport.dryRun.totals.create', { value: formatNumber(dryRunJob.totals.create) })}
            </Badge>
            <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
              {t('dataImport.dryRun.totals.update', { value: formatNumber(dryRunJob.totals.update) })}
            </Badge>
            <Badge variant="secondary">
              {t('dataImport.dryRun.totals.skip', { value: formatNumber(dryRunJob.totals.skip) })}
            </Badge>
            <Badge variant={dryRunJob.totals.error > 0 ? 'destructive' : 'outline'}>
              {t('dataImport.dryRun.totals.error', { value: formatNumber(dryRunJob.totals.error) })}
            </Badge>
          </div>

          {entityType === 'SUPPLIER_PRICE_LIST' ? (
            <div className="flex items-center gap-2 p-3 bg-slate-50 border rounded-md text-sm">
              <Checkbox
                id="step4-opt-create-catalog"
                checked={options.create_new_catalog_items}
                onCheckedChange={(checked) => {
                  setOptions((prev) => ({
                    ...prev,
                    create_new_catalog_items: checked === true,
                  }))
                }}
              />
              <Label htmlFor="step4-opt-create-catalog" className="font-normal cursor-pointer">
                {t('dataImport.mapping.options.createCatalogItems')}
              </Label>
              {options.create_new_catalog_items !==
              Boolean((dryRunJob.options as ImportWizardOptions)?.create_new_catalog_items) ? (
                <span className="text-xs text-amber-600 ml-auto">
                  {t('dataImport.dryRun.rerunRequired')}
                </span>
              ) : null}
            </div>
          ) : null}

          {entityType === 'SUPPLIER_PRICE_LIST' && flaggedJumpCount > 0 ? (
            <div className="flex flex-wrap items-center justify-between gap-4 p-3 bg-amber-50/70 border border-amber-200 rounded-md text-sm">
              <div className="flex items-center gap-2">
                <Checkbox
                  id="step4-accept-price-jumps"
                  checked={acceptAllPriceJumps}
                  onCheckedChange={(checked) => {
                    setAcceptAllPriceJumps(checked === true)
                  }}
                />
                <Label htmlFor="step4-accept-price-jumps" className="font-medium cursor-pointer">
                  {t('dataImport.dryRun.priceJumps.accept')}
                </Label>
                <span className="text-xs text-muted-foreground">
                  {acceptAllPriceJumps
                    ? t('dataImport.dryRun.priceJumps.acceptedAll')
                    : acceptedRowNumbers.length > 0
                      ? t('dataImport.dryRun.priceJumps.acceptedRows', {
                          rows: formatNumber(acceptedRowNumbers.length),
                        })
                      : ''}
                </span>
              </div>
              <Button
                type="button"
                variant="outline"
                size="sm"
                onClick={() => setAcceptAllPriceJumps((prev) => !prev)}
              >
                {acceptAllPriceJumps
                  ? t('dataImport.dryRun.priceJumps.clearSelection')
                  : t('dataImport.dryRun.priceJumps.accept')}
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2 max-w-[200px]">
              <Label htmlFor="import-error-threshold">
                {t('dataImport.dryRun.maxErrors')}
              </Label>
              <Input
                id="import-error-threshold"
                type="number"
                min={0}
                value={errorThreshold}
                onChange={(event) => setErrorThreshold(Number(event.target.value) || 0)}
              />
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-row-filter">{t('dataImport.dryRun.rowFilter')}</Label>
              <Select
                value={rowFilter}
                onValueChange={(value) => {
                  setRowFilter(value as ImportRowFilter)
                  setRowsPage(1)
                }}
              >
                <SelectTrigger id="import-row-filter" className="w-[180px]">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="ALL">{t('dataImport.dryRun.filter.all')}</SelectItem>
                  <SelectItem value="ERROR">{t('dataImport.dryRun.filter.error')}</SelectItem>
                  <SelectItem value="CREATE">{t('dataImport.dryRun.filter.create')}</SelectItem>
                  <SelectItem value="UPDATE">{t('dataImport.dryRun.filter.update')}</SelectItem>
                  <SelectItem value="SKIP">{t('dataImport.dryRun.filter.skip')}</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" onClick={() => void handleDownloadErrors()}>
              <Download className="mr-2 h-4 w-4" />
              {t('dataImport.dryRun.errorRowsCsv')}
            </Button>
          </div>

          {rowsMeta ? (
            <p className="text-sm text-muted-foreground">
              {t('dataImport.dryRun.showing', {
                shown: formatNumber(jobRows.length),
                total: formatNumber(rowsMeta.total),
                page: formatNumber(rowsMeta.page),
                pages: formatNumber(rowsTotalPages),
              })}
            </p>
          ) : null}

          <div className="overflow-x-auto border rounded-md max-h-96">
            {isLoadingRows ? (
              <div className="p-6 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                {t('dataImport.dryRun.loadingRows')}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>{t('dataImport.dryRun.columns.action')}</TableHead>
                    <TableHead>{t('dataImport.dryRun.columns.externalId')}</TableHead>
                    <TableHead>{t('dataImport.dryRun.columns.issues')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobRows.map((row) => {
                    const isPriceJump = isRowPriceJump(row)
                    const thresholdPercent =
                      (dryRunJob.options as ImportWizardOptions)?.price_jump_threshold_percent ??
                      configuredThreshold

                    const warnings = (row.warnings ?? []) as Array<{
                      code?: string
                      message?: string
                    }>

                    const issues = [
                      ...(row.errors ?? []).map((issue) =>
                        t('dataImport.dryRun.issueError', { message: issue.message }),
                      ),
                      ...warnings.map((issue) =>
                        t('dataImport.dryRun.issueWarning', { message: issue.message }),
                      ),
                    ]
                    return (
                      <TableRow key={row.row_no}>
                        <TableCell>{row.row_no}</TableCell>
                        <TableCell>
                          <div className="flex items-center gap-1">
                            <span>{row.action}</span>
                            {isPriceJump ? (
                              <Badge variant="destructive" className="text-[10px]">
                                {t('dataImport.dryRun.priceJumps.badge', {
                                  percent: formatNumber(thresholdPercent),
                                })}
                              </Badge>
                            ) : null}
                          </div>
                        </TableCell>
                        <TableCell className="font-mono text-xs">
                          {typeof row.external_id === 'string'
                            ? row.external_id
                            : row.external_id
                              ? String(row.external_id)
                              : '—'}
                        </TableCell>
                        <TableCell className="text-xs max-w-md whitespace-pre-wrap">
                          {issues.join('\n') || '—'}
                          {entityType === 'SUPPLIER_PRICE_LIST' && isPriceJump ? (
                            <div className="mt-1 flex items-center gap-1.5">
                              <Checkbox
                                id={`accept-row-${row.row_no}`}
                                checked={
                                  acceptAllPriceJumps ||
                                  acceptedRowNumbers.includes(row.row_no)
                                }
                                disabled={acceptAllPriceJumps}
                                onCheckedChange={(checked) => {
                                  if (checked) {
                                    setAcceptedRowNumbers((prev) => [...prev, row.row_no])
                                  } else {
                                    setAcceptedRowNumbers((prev) =>
                                      prev.filter((n) => n !== row.row_no),
                                    )
                                  }
                                }}
                              />
                              <label
                                htmlFor={`accept-row-${row.row_no}`}
                                className="text-xs text-muted-foreground cursor-pointer"
                              >
                                {t('dataImport.dryRun.priceJumps.acceptRow')}
                              </label>
                            </div>
                          ) : null}
                        </TableCell>
                      </TableRow>
                    )
                  })}
                </TableBody>
              </Table>
            )}
          </div>

          {rowsTotalPages > 1 ? (
            <div className="flex items-center gap-2">
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={rowsPage <= 1 || isLoadingRows}
                onClick={() => setRowsPage((page) => Math.max(1, page - 1))}
              >
                {t('dataImport.dryRun.previousPage')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={rowsPage >= rowsTotalPages || isLoadingRows}
                onClick={() => setRowsPage((page) => Math.min(rowsTotalPages, page + 1))}
              >
                {t('dataImport.dryRun.nextPage')}
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(3)}>
              {t('dataImport.dryRun.editMapping')}
            </Button>
            <Button
              type="button"
              disabled={!applyEnabled}
              onClick={() => setConfirmApplyOpen(true)}
            >
              {t('dataImport.dryRun.applyImport')}
            </Button>
          </div>
        </section>
      ) : null}

      {step === 5 && appliedJob ? (
        <section className="space-y-3" aria-labelledby="import-step-result">
          <h4 id="import-step-result" className="font-medium flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            {t('dataImport.result.title')}
          </h4>
          <p className="text-sm text-muted-foreground">
            {t('dataImport.result.summary', {
              status: appliedJob.status,
              created: formatNumber(appliedJob.totals.create),
              updated: formatNumber(appliedJob.totals.update),
              skipped: formatNumber(appliedJob.totals.skip),
              errors: formatNumber(appliedJob.totals.error),
            })}
          </p>
          <Link
            to={auditLogHref}
            className="text-sm text-primary underline underline-offset-4"
          >
            {t('dataImport.result.auditLink')}
          </Link>
        </section>
      ) : null}

      <AlertDialog open={confirmApplyOpen} onOpenChange={setConfirmApplyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dataImport.confirm.title')}</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {t('dataImport.confirm.description')}
                </p>
                <ul className="list-disc pl-5">
                  <li>{t('dataImport.confirm.create', { value: formatNumber(dryRunJob?.totals.create ?? 0) })}</li>
                  <li>{t('dataImport.confirm.update', { value: formatNumber(dryRunJob?.totals.update ?? 0) })}</li>
                  <li>{t('dataImport.confirm.skip', { value: formatNumber(dryRunJob?.totals.skip ?? 0) })}</li>
                  <li>{t('dataImport.confirm.errors', { value: formatNumber(dryRunJob?.totals.error ?? 0) })}</li>
                  {entityType === 'SUPPLIER_PRICE_LIST' ? (
                    <li>
                      {t('dataImport.confirm.priceJumps', {
                        value: acceptAllPriceJumps
                          ? t('dataImport.confirm.priceJumpsAll')
                          : t('dataImport.confirm.priceJumpsRows', {
                              rows: formatNumber(acceptedRowNumbers.length),
                            }),
                      })}
                    </li>
                  ) : null}
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction
              disabled={applyMutation.isPending || applyInFlight}
              onClick={(event) => {
                event.preventDefault()
                void handleApply()
              }}
            >
              {applyMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              {t('dataImport.confirm.confirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
