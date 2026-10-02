import * as React from 'react'
import { Link } from 'react-router-dom'
import {
  AlertTriangle,
  CheckCircle2,
  Download,
  FileUp,
  Loader2,
  Save,
} from 'lucide-react'
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
import { cn } from '@/lib/utils'

import {
  bilingualLabel,
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
  { id: 1, labelEn: 'Source', labelDe: 'Quelle' },
  { id: 2, labelEn: 'Upload', labelDe: 'Upload' },
  { id: 3, labelEn: 'Mapping', labelDe: 'Zuordnung' },
  { id: 4, labelEn: 'Dry-run', labelDe: 'Probelauf' },
  { id: 5, labelEn: 'Apply', labelDe: 'Import' },
] as const

export function DataImportSettingsTab() {
  const [step, setStep] = React.useState(1)
  const [entityType, setEntityType] = React.useState<ImportEntityTypeUi>('CUSTOMER')
  const [sourceSystem, setSourceSystem] = React.useState('incadea')
  const [file, setFile] = React.useState<File | null>(null)
  const [fileFingerprint, setFileFingerprint] = React.useState<string | null>(null)
  const [csvHeaders, setCsvHeaders] = React.useState<string[]>([])
  const [previewRows, setPreviewRows] = React.useState<string[][]>([])
  const [mapping, setMapping] = React.useState<Record<string, string>>({})
  const [options, setOptions] = React.useState<ImportWizardOptions>(DEFAULT_IMPORT_OPTIONS)
  const [errorThreshold, setErrorThreshold] = React.useState(0)
  const [rowFilter, setRowFilter] = React.useState<ImportRowFilter>('ALL')
  const [rowsPage, setRowsPage] = React.useState(1)
  const [dryRunJob, setDryRunJob] = React.useState<ImportJob | null>(null)
  const [appliedJob, setAppliedJob] = React.useState<ImportJob | null>(null)
  const [profileName, setProfileName] = React.useState('')
  const [confirmApplyOpen, setConfirmApplyOpen] = React.useState(false)
  const [applyInFlight, setApplyInFlight] = React.useState(false)
  const applyInFlightRef = React.useRef(false)

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

  const jobRows = rowsResponse?.data ?? []
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
  }, [])

  const handleEntityChange = (value: ImportEntityTypeUi) => {
    setEntityType(value)
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
      const suggested = suggestColumnMapping(parsed.headers, fields)
      setMapping(suggested)
    } catch (error) {
      setFile(null)
      setCsvHeaders([])
      setPreviewRows([])
      setFileFingerprint(null)
      setMapping({})
      toast.error(
        getErrorMessage(error, bilingualLabel('Could not read CSV file', 'CSV-Datei konnte nicht gelesen werden')),
      )
    }
  }

  const handleLoadProfile = (profileId: string) => {
    const profile = profiles.find((item) => item.id === profileId)
    if (!profile) return
    setMapping(constrainMappingToCsvHeaders(profile.mapping, csvHeaders))
    resetDryRun()
    toast.success(bilingualLabel('Mapping profile loaded', 'Zuordnungsprofil geladen'))
  }

  const handleSaveProfile = async () => {
    const name = profileName.trim()
    if (!name) {
      toast.error('Enter a profile name / Profilnamen eingeben')
      return
    }
    try {
      await saveProfileMutation.mutateAsync({
        entity_type: entityType as ImportEntityType,
        source_system: sourceSystem.trim(),
        name,
        mapping,
      })
      toast.success('Mapping profile saved / Zuordnung gespeichert')
      setProfileName('')
    } catch (error) {
      toast.error(
        getErrorMessage(error, bilingualLabel('Failed to save profile', 'Profil konnte nicht gespeichert werden')),
      )
    }
  }

  const handleRunDryRun = async () => {
    if (!file) {
      toast.error(bilingualLabel('Select a CSV file first', 'Zuerst eine CSV-Datei auswählen'))
      return
    }
    if (missingRequired.length > 0) {
      toast.error(
        bilingualLabel(
          'Map all required fields before running dry-run',
          'Pflichtfelder zuordnen, bevor der Probelauf startet',
        ),
      )
      return
    }

    try {
      const job = await dryRunMutation.mutateAsync({
        file,
        entityType: entityType as ImportEntityType,
        sourceSystem: sourceSystem.trim(),
        mapping,
        options,
      })
      setDryRunJob(job)
      setFileFingerprint(job.file_sha256)
      setAppliedJob(null)
      setStep(4)
      setRowFilter('ALL')
      setRowsPage(1)
    } catch (error) {
      toast.error(getErrorMessage(error, bilingualLabel('Dry-run failed', 'Probelauf fehlgeschlagen')))
    }
  }

  const handleApply = async () => {
    if (!dryRunJob || !applyEnabled || applyInFlightRef.current) return
    applyInFlightRef.current = true
    setApplyInFlight(true)
    try {
      const result = await applyMutation.mutateAsync(dryRunJob.id)
      setAppliedJob(result)
      setDryRunJob(result)
      setStep(5)
      setConfirmApplyOpen(false)
      toast.success(
        bilingualLabel('Import applied successfully', 'Import erfolgreich angewendet'),
      )
    } catch (error) {
      toast.error(getErrorMessage(error, bilingualLabel('Apply failed', 'Import fehlgeschlagen')))
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
        getErrorMessage(
          error,
          bilingualLabel('Template download failed', 'Vorlage konnte nicht heruntergeladen werden'),
        ),
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
        getErrorMessage(
          error,
          bilingualLabel('Error CSV download failed', 'Fehler-CSV konnte nicht heruntergeladen werden'),
        ),
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
          <h3 className="text-lg font-medium">Data import / Datenimport</h3>
          <p className="text-sm text-muted-foreground max-w-2xl">
            Legacy DMS CSV import for pilot customer onboarding. Dry-run validates rows before any
            write. Marketing consent columns are ignored by the import engine.
          </p>
        </div>
      </div>

      <nav aria-label="Import wizard steps" className="flex flex-wrap gap-2">
        {WIZARD_STEPS.map((wizardStep) => (
          <Badge
            key={wizardStep.id}
            variant={step === wizardStep.id ? 'default' : 'outline'}
            className={cn('text-xs', step > wizardStep.id && 'border-green-600 text-green-700')}
          >
            {wizardStep.id}. {wizardStep.labelEn} / {wizardStep.labelDe}
          </Badge>
        ))}
      </nav>

      <Alert>
        <AlertTriangle className="h-4 w-4" />
        <AlertTitle>Marketing consent / Marketing-Einwilligung</AlertTitle>
        <AlertDescription>
          Columns related to consent, marketing, newsletter, or Werbung are not imported and are
          reported as warnings only.
        </AlertDescription>
      </Alert>

      {step === 1 && (
        <section className="space-y-4" aria-labelledby="import-step-source">
          <h4 id="import-step-source" className="font-medium">
            1. Entity &amp; source / Entität &amp; Quelle
          </h4>
          <div className="grid gap-4 md:grid-cols-2 max-w-2xl">
            <div className="space-y-2">
              <Label htmlFor="import-entity">Entity / Entität</Label>
              <Select
                value={entityType}
                onValueChange={(value) => handleEntityChange(value as ImportEntityTypeUi)}
              >
                <SelectTrigger id="import-entity">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="CUSTOMER">Customers / Kunden</SelectItem>
                  <SelectItem value="VEHICLE">Vehicles / Fahrzeuge</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <div className="space-y-2">
              <Label htmlFor="import-source">Source system / Quellsystem</Label>
              <Input
                id="import-source"
                value={sourceSystem}
                onChange={(event) => {
                  setSourceSystem(event.target.value)
                  resetDryRun()
                }}
              />
            </div>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => void handleDownloadTemplate()}>
              <Download className="mr-2 h-4 w-4" />
              Download CSV template / CSV-Vorlage
            </Button>
            <Button type="button" onClick={() => setStep(2)}>
              Continue / Weiter
            </Button>
          </div>
          {template?.fields?.length ? (
            <p className="text-xs text-muted-foreground">
              Template fields: {template.fields.map((field) => field.key).join(', ')}
            </p>
          ) : null}
        </section>
      )}

      {step === 2 && (
        <section className="space-y-4" aria-labelledby="import-step-upload">
          <h4 id="import-step-upload" className="font-medium">
            2. Upload CSV / CSV hochladen
          </h4>
          <div className="space-y-2 max-w-lg">
            <Label htmlFor="import-file">CSV file / CSV-Datei</Label>
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
                {file.name} ({csvHeaders.length} columns / Spalten)
              </p>
            ) : null}
          </div>
          <div className="flex gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(1)}>
              Back / Zurück
            </Button>
            <Button type="button" disabled={!file} onClick={() => setStep(3)}>
              Continue / Weiter
            </Button>
          </div>
        </section>
      )}

      {step === 3 && (
        <section className="space-y-4" aria-labelledby="import-step-mapping">
          <h4 id="import-step-mapping" className="font-medium">
            3. Column mapping / Spaltenzuordnung
          </h4>

          <div className="flex flex-col gap-3 md:flex-row md:items-end">
            <div className="space-y-2 flex-1 max-w-xs">
              <Label htmlFor="import-profile-load">Saved profile / Gespeichertes Profil</Label>
              <Select onValueChange={handleLoadProfile}>
                <SelectTrigger id="import-profile-load">
                  <SelectValue placeholder="Load profile…" />
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
                <Label htmlFor="import-profile-name">Save as / Speichern als</Label>
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
                {bilingualLabel('Save profile', 'Profil speichern')}
              </Button>
            </div>
          </div>

          <div className="overflow-x-auto border rounded-md">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>ACP field / ACP-Feld</TableHead>
                  <TableHead>CSV column / CSV-Spalte</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {fields.map((field) => (
                  <TableRow key={field.key}>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        <span>{formatFieldLabel(field)}</span>
                        {field.required ? (
                          <Badge variant="destructive" className="text-[10px]">
                            Required / Pflicht
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
                        <SelectTrigger aria-label={`Map ${field.key}`}>
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
              Map required fields: {missingRequired.join(', ')}
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
                Update existing / Bestehende aktualisieren
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
                Fill empty only / Nur leere Felder füllen
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
                  Allow missing VIN / FIN optional
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
                  Invalid VAT ID as error / Ungültige UID als Fehler
                </Label>
              </div>
            ) : null}
          </div>

          {previewRows.length > 0 ? (
            <div className="space-y-2">
              <h5 className="text-sm font-medium">Preview (first 20 rows) / Vorschau</h5>
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
              Back / Zurück
            </Button>
            <Button
              type="button"
              disabled={!file || missingRequired.length > 0 || dryRunMutation.isPending}
              onClick={() => void handleRunDryRun()}
            >
              {dryRunMutation.isPending ? (
                <Loader2 className="mr-2 h-4 w-4 animate-spin" />
              ) : null}
              Run dry-run / Probelauf starten
            </Button>
          </div>
        </section>
      )}

      {step >= 4 && dryRunJob ? (
        <section className="space-y-4" aria-labelledby="import-step-dryrun">
          <h4 id="import-step-dryrun" className="font-medium">
            4. Dry-run report / Probelauf-Bericht
          </h4>

          {dryRunStale ? (
            <Alert variant="destructive">
              <AlertTriangle className="h-4 w-4" />
              <AlertTitle>Stale dry-run / Veralteter Probelauf</AlertTitle>
              <AlertDescription>
                File, mapping, or options changed after the last dry-run. Run dry-run again before
                applying.
              </AlertDescription>
            </Alert>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Badge variant="outline">Rows / Zeilen: {dryRunJob.totals.rows}</Badge>
            <Badge className="bg-green-100 text-green-800 hover:bg-green-100">
              Create / Neu: {dryRunJob.totals.create}
            </Badge>
            <Badge className="bg-blue-100 text-blue-800 hover:bg-blue-100">
              Update / Update: {dryRunJob.totals.update}
            </Badge>
            <Badge variant="secondary">Skip / Übersprungen: {dryRunJob.totals.skip}</Badge>
            <Badge variant={dryRunJob.totals.error > 0 ? 'destructive' : 'outline'}>
              Error / Fehler: {dryRunJob.totals.error}
            </Badge>
          </div>

          <div className="flex flex-wrap items-end gap-4">
            <div className="space-y-2 max-w-[200px]">
              <Label htmlFor="import-error-threshold">
                {bilingualLabel('Max errors to allow apply', 'Max. Fehler für Import')}
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
              <Label htmlFor="import-row-filter">Row filter / Zeilenfilter</Label>
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
                  <SelectItem value="ALL">All / Alle</SelectItem>
                  <SelectItem value="ERROR">Errors / Fehler</SelectItem>
                  <SelectItem value="CREATE">Create / Neu</SelectItem>
                  <SelectItem value="UPDATE">Update</SelectItem>
                  <SelectItem value="SKIP">Skip</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button type="button" variant="outline" onClick={() => void handleDownloadErrors()}>
              <Download className="mr-2 h-4 w-4" />
              {bilingualLabel('Error rows CSV', 'Fehlerzeilen CSV')}
            </Button>
          </div>

          {rowsMeta ? (
            <p className="text-sm text-muted-foreground">
              {bilingualLabel('Showing', 'Angezeigt')}{' '}
              {jobRows.length} {bilingualLabel('of', 'von')} {rowsMeta.total}{' '}
              {bilingualLabel('rows (page', 'Zeilen (Seite')} {rowsMeta.page}{' '}
              {bilingualLabel('of', 'von')} {rowsTotalPages})
            </p>
          ) : null}

          <div className="overflow-x-auto border rounded-md max-h-96">
            {isLoadingRows ? (
              <div className="p-6 flex items-center justify-center text-muted-foreground">
                <Loader2 className="h-5 w-5 animate-spin mr-2" />
                {bilingualLabel('Loading rows…', 'Zeilen werden geladen…')}
              </div>
            ) : (
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>#</TableHead>
                    <TableHead>{bilingualLabel('Action', 'Aktion')}</TableHead>
                    <TableHead>{bilingualLabel('External ID', 'Externe ID')}</TableHead>
                    <TableHead>{bilingualLabel('Issues', 'Hinweise')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {jobRows.map((row) => {
                    const issues = [
                      ...(row.errors ?? []).map(
                        (issue) =>
                          `${bilingualLabel('Error', 'Fehler')}: ${issue.message}`,
                      ),
                      ...(row.warnings ?? []).map(
                        (issue) =>
                          `${bilingualLabel('Warning', 'Warnung')}: ${issue.message}`,
                      ),
                    ]
                    return (
                      <TableRow key={row.row_no}>
                        <TableCell>{row.row_no}</TableCell>
                        <TableCell>{row.action}</TableCell>
                        <TableCell className="font-mono text-xs">
                          {typeof row.external_id === 'string'
                            ? row.external_id
                            : row.external_id
                              ? String(row.external_id)
                              : '—'}
                        </TableCell>
                        <TableCell className="text-xs max-w-md whitespace-pre-wrap">
                          {issues.join('\n') || '—'}
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
                {bilingualLabel('Previous page', 'Vorherige Seite')}
              </Button>
              <Button
                type="button"
                variant="outline"
                size="sm"
                disabled={rowsPage >= rowsTotalPages || isLoadingRows}
                onClick={() => setRowsPage((page) => Math.min(rowsTotalPages, page + 1))}
              >
                {bilingualLabel('Next page', 'Nächste Seite')}
              </Button>
            </div>
          ) : null}

          <div className="flex flex-wrap gap-2">
            <Button type="button" variant="outline" onClick={() => setStep(3)}>
              Edit mapping / Zuordnung bearbeiten
            </Button>
            <Button
              type="button"
              disabled={!applyEnabled}
              onClick={() => setConfirmApplyOpen(true)}
            >
              Apply import / Import anwenden
            </Button>
          </div>
        </section>
      ) : null}

      {step === 5 && appliedJob ? (
        <section className="space-y-3" aria-labelledby="import-step-result">
          <h4 id="import-step-result" className="font-medium flex items-center gap-2">
            <CheckCircle2 className="h-5 w-5 text-green-600" />
            Import complete / Import abgeschlossen
          </h4>
          <p className="text-sm text-muted-foreground">
            {bilingualLabel('Status', 'Status')}: {appliedJob.status}.{' '}
            {bilingualLabel('Created', 'Neu')} {appliedJob.totals.create},{' '}
            {bilingualLabel('updated', 'aktualisiert')} {appliedJob.totals.update},{' '}
            {bilingualLabel('skipped', 'übersprungen')} {appliedJob.totals.skip},{' '}
            {bilingualLabel('errors', 'Fehler')} {appliedJob.totals.error}.
          </p>
          <Link
            to={auditLogHref}
            className="text-sm text-primary underline underline-offset-4"
          >
            View audit log for this import job / Audit-Log für diesen Import anzeigen
          </Link>
        </section>
      ) : null}

      <AlertDialog open={confirmApplyOpen} onOpenChange={setConfirmApplyOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Apply import? / Import anwenden?</AlertDialogTitle>
            <AlertDialogDescription asChild>
              <div className="space-y-2 text-sm">
                <p>
                  {bilingualLabel(
                    'This writes data to your tenant. Counts from the last dry-run:',
                    'Schreibt Daten in Ihren Mandanten. Zahlen aus dem letzten Probelauf:',
                  )}
                </p>
                <ul className="list-disc pl-5">
                  <li>Create / Neu: {dryRunJob?.totals.create ?? 0}</li>
                  <li>Update: {dryRunJob?.totals.update ?? 0}</li>
                  <li>Skip: {dryRunJob?.totals.skip ?? 0}</li>
                  <li>Errors (skipped) / Fehler: {dryRunJob?.totals.error ?? 0}</li>
                </ul>
              </div>
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel / Abbrechen</AlertDialogCancel>
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
              Confirm apply / Bestätigen
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
