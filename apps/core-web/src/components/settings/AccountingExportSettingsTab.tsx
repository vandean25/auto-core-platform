import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { format } from 'date-fns'
import {
  AlertTriangle,
  Download,
  Eye,
  FileSpreadsheet,
  Loader2,
  Play,
  Search,
} from 'lucide-react'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  type AccountingExportPreviewResponseDto,
  type AccountingExportSummaryDto,
  computeBlobSha256Hex,
  downloadAccountingExportCsv,
  useAccountingExportDetail,
  useAccountingExports,
  useGenerateAccountingExport,
  usePreviewAccountingExport,
} from '@/api/useAccountingExports'
import type { components } from '@/api/generated/openapi'
import { useLegalEntities } from '@/api/site-admin'
import { LegalEntityAccountingProfileForm } from '@/components/settings/LegalEntitiesSettingsTab'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { StatusBadge } from '@/components/status/StatusBadge'
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
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from '@/components/ui/sheet'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import type { DocumentSaveStatus } from '@/hooks/useDebouncedAutoSave'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { triggerBlobDownload } from '@/lib/download'
import { getErrorMessage, getErrorStatus } from '@/lib/error-utils'

const DATEV_PROFILE_CODE = 'ACP-DATEV-DE-EUR-1'

function truncateHash(value: string, visible = 10): string {
  if (value.length <= visible * 2 + 3) return value
  return `${value.slice(0, visible)}…${value.slice(-visible)}`
}

function formatExportTimestamp(value: string): string {
  const date = new Date(value)
  if (Number.isNaN(date.getTime())) return '—'
  return format(date, 'yyyy-MM-dd HH:mm')
}

type AccountingExportBlockerDto =
  components['schemas']['AccountingExportBlockerDto']

function getBlockerSettingsTab(blocker: AccountingExportBlockerDto): string | null {
  switch (blocker.code) {
    case 'EXPORT_PERIOD_NOT_CLOSED':
      return 'finance'
    case 'ACCOUNTING_MAPPING_INCOMPLETE':
    case 'EXPORT_PROFILE_NOT_READY':
    case 'EXPORT_PROFILE_DISABLED':
      return 'legal-entities'
    case 'EXPORT_SCOPE_INCOMPLETE':
      return 'sites'
    default:
      return null
  }
}

function getBlockerSettingsLabel(tab: string): string {
  switch (tab) {
    case 'finance':
      return 'Open Finance settings'
    case 'legal-entities':
      return 'Open Legal Entities settings'
    case 'sites':
      return 'Open Sites settings'
    default:
      return 'Open settings'
  }
}

type AccountingExportSettingsTabProps = {
  canManageExports: boolean
}

export function AccountingExportSettingsTab({
  canManageExports,
}: AccountingExportSettingsTabProps) {
  const [, setSearchParams] = useSearchParams()
  const { data: legalEntities = [], isLoading: isLoadingEntities } = useLegalEntities()

  const [legalEntityId, setLegalEntityId] = React.useState('')
  const [dateFrom, setDateFrom] = React.useState('')
  const [dateTo, setDateTo] = React.useState('')
  const [preview, setPreview] = React.useState<AccountingExportPreviewResponseDto | null>(
    null,
  )
  const [previewForbidden, setPreviewForbidden] = React.useState(false)
  const [acknowledgeOverlap, setAcknowledgeOverlap] = React.useState(false)
  const [lastGeneratedId, setLastGeneratedId] = React.useState<string | null>(null)
  const [lastGeneratedSha256, setLastGeneratedSha256] = React.useState<string | null>(
    null,
  )
  const [overlapDialogOpen, setOverlapDialogOpen] = React.useState(false)
  const [selectedRunId, setSelectedRunId] = React.useState<string | null>(null)
  const [profileSaveStatus, setProfileSaveStatus] =
    React.useState<DocumentSaveStatus>('idle')
  const [isDownloading, setIsDownloading] = React.useState(false)

  const previewMutation = usePreviewAccountingExport()
  const generateMutation = useGenerateAccountingExport()

  const { queryParams, setPagination, ...tableState } = useDataTableQuery({
    defaultPageSize: 10,
    initialSorting: [{ id: 'createdAt', desc: true }],
  })

  const handleDownload = React.useCallback(
    async (
      exportId: string,
      expectedSha256?: string | null,
      filenameHint?: string,
    ) => {
      setIsDownloading(true)
      try {
        const { blob, sha256, filename } = await downloadAccountingExportCsv(
          exportId,
          expectedSha256 ?? undefined,
        )
        const computed = await computeBlobSha256Hex(blob)
        const reference = expectedSha256 ?? sha256
        if (reference && computed !== reference) {
          toast.error('Download checksum mismatch', {
            description:
              'The file bytes do not match the recorded SHA-256. Do not import this file.',
          })
          return
        }
        triggerBlobDownload(blob, filenameHint ?? filename)
        toast.success('Export downloaded', {
          description:
            'Download is logged for audit. Auto Core Platform does not track DATEV import status.',
        })
      } catch (error: unknown) {
        toast.error(getErrorMessage(error, 'Download failed'))
      } finally {
        setIsDownloading(false)
      }
    },
    [],
  )

  const historyQuery = useAccountingExports({
    page: queryParams.page,
    limit: queryParams.pageSize,
    search: queryParams.search,
    legalEntityId: legalEntityId || undefined,
  })

  const detailQuery = useAccountingExportDetail(selectedRunId)

  React.useEffect(() => {
    if (legalEntityId || legalEntities.length === 0) return
    const firstActive = legalEntities.find((entity) => entity.is_active)
    if (firstActive) {
      setLegalEntityId(firstActive.id)
    }
  }, [legalEntities, legalEntityId])

  const selectedEntity = React.useMemo(
    () => legalEntities.find((entity) => entity.id === legalEntityId) ?? null,
    [legalEntities, legalEntityId],
  )

  const entityNameById = React.useMemo(
    () => new Map(legalEntities.map((entity) => [entity.id, entity.name])),
    [legalEntities],
  )

  const periodReady = Boolean(legalEntityId && dateFrom && dateTo)
  const profileSaveBlocking =
    profileSaveStatus === 'saving' || profileSaveStatus === 'error'

  const invalidatePreview = React.useCallback(() => {
    setPreview(null)
    setPreviewForbidden(false)
    setAcknowledgeOverlap(false)
  }, [])

  React.useEffect(() => {
    invalidatePreview()
  }, [dateFrom, dateTo, legalEntityId, invalidatePreview])

  const openSettingsTab = (tab: string) => {
    setSearchParams({ tab })
  }

  const handlePreview = async () => {
    if (!periodReady) {
      toast.error('Select a legal entity and closed period dates first.')
      return
    }

    setPreviewForbidden(false)
    try {
      const result = await previewMutation.mutateAsync({
        legalEntityId,
        dateFrom,
        dateTo,
      })
      setPreview(result)
      setAcknowledgeOverlap(false)
      if (result.overlaps.length > 0) {
        toast.message('Overlapping export runs detected', {
          description:
            'Importing overlapping DATEV files can duplicate bookings. Acknowledge before generating a new run.',
        })
      }
    } catch (error: unknown) {
      setPreview(null)
      if (getErrorStatus(error) === 403) {
        setPreviewForbidden(true)
        toast.error(
          'You do not have access to export this legal entity for the selected period.',
        )
        return
      }
      toast.error(getErrorMessage(error, 'Preview failed'))
    }
  }

  const runGenerate = async (withOverlapAck: boolean) => {
    if (!preview || !periodReady) {
      toast.error('Run preview before generating an export.')
      return
    }
    if (profileSaveBlocking) {
      toast.error('Wait until accounting profile changes finish saving.')
      return
    }
    if (!preview.canGenerate) {
      toast.error(
        'Export is blocked. Resolve all blockers or enable the DATEV profile before generating.',
      )
      return
    }
    if (preview.overlaps.length > 0 && !withOverlapAck && !acknowledgeOverlap) {
      setOverlapDialogOpen(true)
      return
    }

    try {
      const created = await generateMutation.mutateAsync({
        legalEntityId,
        dateFrom,
        dateTo,
        previewHash: preview.previewHash,
        profileVersion: preview.profileVersion,
        idempotencyKey: crypto.randomUUID(),
        acknowledgeOverlap: withOverlapAck || acknowledgeOverlap,
      })
      setLastGeneratedId(created.id)
      setLastGeneratedSha256(created.sha256)
      toast.success('DATEV export generated', {
        description: `${created.documentCount} documents · SHA-256 ${truncateHash(created.sha256)}`,
      })
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Generate failed'))
    } finally {
      setOverlapDialogOpen(false)
    }
  }

  const historyRows = historyQuery.data?.data ?? []

  const columns = React.useMemo<ColumnDef<AccountingExportSummaryDto>[]>(
    () => [
      {
        accessorKey: 'legalEntityId',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Legal entity" />
        ),
        cell: ({ row }) =>
          entityNameById.get(row.original.legalEntityId) ??
          truncateHash(row.original.legalEntityId, 6),
      },
      {
        id: 'period',
        header: 'Period',
        cell: ({ row }) => `${row.original.dateFrom} → ${row.original.dateTo}`,
      },
      {
        accessorKey: 'documentCount',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Documents" />
        ),
      },
      {
        accessorKey: 'createdAt',
        header: ({ column }) => (
          <DataTableColumnHeader column={column} title="Created" />
        ),
        cell: ({ row }) => formatExportTimestamp(row.original.createdAt),
      },
      {
        accessorKey: 'sha256',
        header: 'Checksum',
        cell: ({ row }) => (
          <span className="font-mono text-xs" title={row.original.sha256}>
            {truncateHash(row.original.sha256)}
          </span>
        ),
      },
      {
        id: 'actions',
        header: '',
        cell: ({ row }) => (
          <Button
            type="button"
            variant="ghost"
            size="sm"
            onClick={(event) => {
              event.stopPropagation()
              void handleDownload(row.original.id, row.original.sha256, row.original.filename)
            }}
          >
            <Download className="mr-1 h-3.5 w-3.5" />
            Download
          </Button>
        ),
      },
    ],
    [entityNameById, handleDownload],
  )

  if (!canManageExports) {
    return (
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3 text-slate-700">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
          <div>
            <h3 className="text-lg font-medium">Accounting export</h3>
            <p className="mt-1 text-sm text-slate-600">
              Only tenant OWNER and ADMIN users with complete site access can preview or
              download DATEV accounting exports.
            </p>
          </div>
        </div>
      </div>
    )
  }

  if (isLoadingEntities) {
    return (
      <div className="flex min-h-[240px] items-center justify-center rounded-lg border bg-white p-6 shadow-sm">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (legalEntities.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">
          Create a legal entity before configuring DATEV accounting export.
        </p>
        <Button
          type="button"
          variant="link"
          className="mt-2 h-auto px-0"
          onClick={() => openSettingsTab('legal-entities')}
        >
          Open Legal Entities settings
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-lg border bg-white p-6 shadow-sm lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <h3 className="text-lg font-medium">Accounting export</h3>
          <p className="max-w-2xl text-sm text-slate-600">
            Preview and download immutable DATEV Buchungsstapel CSV runs for a closed period.
            Generation requires profile <span className="font-mono text-xs">{DATEV_PROFILE_CODE}</span>{' '}
            to be enabled after accountant approval.
          </p>
          {selectedEntity ? (
            <p className="text-sm text-slate-500">
              Selected: <span className="font-medium text-slate-700">{selectedEntity.name}</span>
              {periodReady ? (
                <>
                  {' '}
                  · {dateFrom} to {dateTo}
                </>
              ) : null}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <Button
            type="button"
            variant="outline"
            onClick={() => void handlePreview()}
            disabled={!periodReady || previewMutation.isPending}
          >
            {previewMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Search className="mr-2 h-4 w-4" />
            )}
            Preview
          </Button>
          <Button
            type="button"
            onClick={() => void runGenerate(false)}
            disabled={
              !preview?.canGenerate ||
              profileSaveBlocking ||
              generateMutation.isPending ||
              previewMutation.isPending
            }
          >
            {generateMutation.isPending ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Play className="mr-2 h-4 w-4" />
            )}
            Generate
          </Button>
          <Button
            type="button"
            variant="secondary"
            disabled={!lastGeneratedId || isDownloading}
            onClick={() => {
              if (!lastGeneratedId) return
              void handleDownload(lastGeneratedId, lastGeneratedSha256)
            }}
          >
            {isDownloading ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <Download className="mr-2 h-4 w-4" />
            )}
            Download latest
          </Button>
        </div>
      </div>

      <div className="grid gap-4 rounded-lg border bg-white p-6 shadow-sm md:grid-cols-3">
        <div className="grid gap-2 md:col-span-1">
          <Label htmlFor="export-legal-entity">Legal entity</Label>
          <Select value={legalEntityId} onValueChange={setLegalEntityId}>
            <SelectTrigger id="export-legal-entity">
              <SelectValue placeholder="Select entity" />
            </SelectTrigger>
            <SelectContent>
              {legalEntities.map((entity) => (
                <SelectItem key={entity.id} value={entity.id}>
                  {entity.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <div className="grid gap-2">
          <Label htmlFor="export-date-from">Date from</Label>
          <Input
            id="export-date-from"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="export-date-to">Date to</Label>
          <Input
            id="export-date-to"
            type="date"
            value={dateTo}
            onChange={(event) => setDateTo(event.target.value)}
          />
        </div>
      </div>

      {selectedEntity ? (
        <LegalEntityAccountingProfileForm
          entity={selectedEntity}
          onSaveStatusChange={setProfileSaveStatus}
        />
      ) : null}

      {previewForbidden ? (
        <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-900">
          Export scope is incomplete for your account. No document totals are shown. Review
          site memberships and legal entity access with an administrator.
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <FileSpreadsheet className="h-5 w-5 text-slate-500" />
            <div>
              <h4 className="font-medium">Preview results</h4>
              <p className="text-sm text-slate-500">
                Profile v{preview.profileVersion} · {preview.documentCount} documents ·{' '}
                {preview.rowCount} booking rows
              </p>
            </div>
            <StatusBadge status={preview.canGenerate ? 'ACTIVE' : 'INACTIVE'} />
          </div>

          {preview.blockers.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">Blocking issues</p>
              <ul className="space-y-2">
                {preview.blockers.map((blocker, index) => {
                  const settingsTab = getBlockerSettingsTab(blocker)
                  return (
                    <li
                      key={`${blocker.code}-${blocker.documentId ?? index}`}
                      className="rounded-md border border-red-200 bg-red-50 p-3 text-sm text-red-900"
                    >
                      <p>{blocker.message}</p>
                      {blocker.documentNumber ? (
                        <p className="mt-1 font-mono text-xs">{blocker.documentNumber}</p>
                      ) : null}
                      {settingsTab ? (
                        <Button
                          type="button"
                          variant="link"
                          className="mt-1 h-auto px-0 text-red-900"
                          onClick={() => openSettingsTab(settingsTab)}
                        >
                          {getBlockerSettingsLabel(settingsTab)}
                        </Button>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
              <p className="text-xs text-slate-500">
                Exports never omit blocked documents or export valid rows only.
              </p>
            </div>
          ) : null}

          {preview.documentCount === 0 && preview.blockers.length === 0 ? (
            <p className="text-sm text-slate-600">
              This closed period contains no exportable documents. Generation is not available
              for empty periods.
            </p>
          ) : null}

          {preview.totals.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Account</TableHead>
                    <TableHead>Tax rate</TableHead>
                    <TableHead>Net</TableHead>
                    <TableHead>Tax</TableHead>
                    <TableHead>Gross</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.totals.map((bucket) => (
                    <TableRow key={`${bucket.account}-${bucket.taxRate}`}>
                      <TableCell className="font-mono text-sm">{bucket.account}</TableCell>
                      <TableCell>{bucket.taxRate}%</TableCell>
                      <TableCell>{bucket.net}</TableCell>
                      <TableCell>{bucket.tax}</TableCell>
                      <TableCell>{bucket.gross}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {preview.overlaps.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-medium">Overlapping export runs</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {preview.overlaps.map((overlap) => (
                  <li key={overlap.id}>
                    {overlap.dateFrom} → {overlap.dateTo} · {overlap.documentCount} docs ·{' '}
                    {formatExportTimestamp(overlap.createdAt)} ·{' '}
                    <span className="font-mono text-xs">{truncateHash(overlap.fileSha256)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                Importing overlapping files into DATEV can duplicate bookings. Auto Core Platform
                does not know whether DATEV already imported a prior file.
              </p>
              <div className="mt-3 flex items-start gap-2">
                <Checkbox
                  id="export-overlap-ack"
                  checked={acknowledgeOverlap}
                  onCheckedChange={(checked) => setAcknowledgeOverlap(checked === true)}
                />
                <Label htmlFor="export-overlap-ack" className="font-normal leading-snug">
                  I understand duplicate import risk and still want to generate a new run.
                </Label>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <div>
            <h4 className="font-medium">Export run history</h4>
            <p className="text-sm text-slate-500">
              Immutable completed runs. Downloads are audit-logged with run ID and checksum; they
              do not confirm DATEV import.
            </p>
          </div>
        </div>
        <DataTable
          columns={columns}
          data={historyRows}
          isLoading={historyQuery.isLoading}
          pageCount={historyQuery.data?.meta.pageCount ?? 1}
          searchPlaceholder="Search runs by ID, entity, or checksum..."
          setPagination={setPagination}
          onRowClick={(row) => setSelectedRunId(row.id)}
          emptyStateMessage="No authorized export runs yet."
          {...tableState}
        />
      </div>

      <Sheet open={Boolean(selectedRunId)} onOpenChange={(open) => !open && setSelectedRunId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>Export run details</SheetTitle>
            <SheetDescription>
              Exact metadata stored with the immutable CSV artifact.
            </SheetDescription>
          </SheetHeader>
          {detailQuery.isLoading ? (
            <div className="flex items-center justify-center py-12">
              <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
            </div>
          ) : detailQuery.data ? (
            <div className="mt-6 space-y-4 text-sm">
              <div className="grid gap-2">
                <p>
                  <span className="text-slate-500">Run ID:</span>{' '}
                  <span className="font-mono text-xs">{detailQuery.data.id}</span>
                </p>
                <p>
                  <span className="text-slate-500">Period:</span> {detailQuery.data.dateFrom} →{' '}
                  {detailQuery.data.dateTo}
                </p>
                <p>
                  <span className="text-slate-500">Documents / rows:</span>{' '}
                  {detailQuery.data.documentCount} / {detailQuery.data.rowCount}
                </p>
                <p>
                  <span className="text-slate-500">SHA-256:</span>{' '}
                  <span className="break-all font-mono text-xs">{detailQuery.data.sha256}</span>
                </p>
                <p>
                  <span className="text-slate-500">Created:</span>{' '}
                  {formatExportTimestamp(detailQuery.data.createdAt)}
                </p>
              </div>
              <Button
                type="button"
                className="w-full"
                disabled={isDownloading}
                onClick={() =>
                  void handleDownload(
                    detailQuery.data!.id,
                    detailQuery.data!.sha256,
                    detailQuery.data!.filename,
                  )
                }
              >
                <Download className="mr-2 h-4 w-4" />
                Download CSV
              </Button>
              <p className="text-xs text-slate-500">
                Download events record who retrieved these bytes and the checksum. They do not
                indicate successful DATEV import.
              </p>
            </div>
          ) : (
            <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
              <Eye className="h-4 w-4" />
              Select a run from the history table.
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={overlapDialogOpen} onOpenChange={setOverlapDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>Confirm overlapping export</AlertDialogTitle>
            <AlertDialogDescription>
              This period overlaps prior export runs. Importing both files into DATEV can duplicate
              bookings. Auto Core Platform cannot detect whether DATEV already imported an earlier
              file.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>Cancel</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runGenerate(true)}>
              Generate anyway
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
