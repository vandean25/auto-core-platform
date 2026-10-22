import * as React from 'react'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import type { TFunction } from 'i18next'
import {
  AlertTriangle,
  Download,
  Eye,
  FileSpreadsheet,
  Loader2,
  Play,
  Search,
} from 'lucide-react'
import { Trans, useTranslation } from 'react-i18next'
import { useSearchParams } from 'react-router-dom'
import { toast } from 'sonner'

import {
  type AccountingExportPreviewResponseDto,
  type AccountingExportSummaryDto,
  downloadAccountingExportCsv,
  useAccountingExportDetail,
  useAccountingExports,
  useGenerateAccountingExport,
  usePreviewAccountingExport,
} from '@/api/useAccountingExports'
import type { components } from '@/api/generated/openapi'
import { useLegalEntities } from '@/api/site-admin'
import { useTenantMembers } from '@/api/tenant-members'
import { SettingsSectionHeading, SettingsSubsectionIntro } from '@/components/settings/SettingsSectionHeading'
import {
  SettingsIconActionButton,
  SettingsTabLoadingState,
} from '@/components/settings/settings-tab-shared'
import { LegalEntityAccountingProfileForm } from '@/components/settings/LegalEntitiesSettingsTab'
import { DataTable } from '@/components/data-table/DataTable'
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
import { formatCurrency, formatDateTime, formatIsoDateOnly, formatNumber, formatPercent } from '@/lib/format'

const DATEV_PROFILE_CODE = 'ACP-DATEV-DE-EUR-1'

function truncateHash(value: string, visible = 10): string {
  if (value.length <= visible * 2 + 3) return value
  return `${value.slice(0, visible)}…${value.slice(-visible)}`
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

function getBlockerSettingsLabel(tab: string, t: TFunction<'settings'>): string {
  switch (tab) {
    case 'finance':
      return t('accountingExport.settingsLinks.finance')
    case 'legal-entities':
      return t('accountingExport.settingsLinks.legalEntities')
    case 'sites':
      return t('accountingExport.settingsLinks.sites')
    default:
      return t('accountingExport.settingsLinks.default')
  }
}

function formatTenantMemberDisplayName(member: {
  firstName?: string | null
  lastName?: string | null
  email: string
}): string {
  const fullName = [member.firstName, member.lastName].filter(Boolean).join(' ').trim()
  return fullName.length > 0 ? fullName : member.email
}

type AccountingExportSettingsTabProps = {
  canManageExports: boolean
}

export function AccountingExportSettingsPanel({
  canManageExports,
}: AccountingExportSettingsTabProps) {
  const { t } = useTranslation(['settings', 'common'])
  const [, setSearchParams] = useSearchParams()
  const { data: legalEntities = [], isLoading: isLoadingEntities } = useLegalEntities()
  const { data: tenantMembersResponse } = useTenantMembers({
    includeInactive: true,
    limit: 100,
  })

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
  })

  const actorNameByUserId = React.useMemo(() => {
    const map = new Map<string, string>()
    for (const member of tenantMembersResponse?.data ?? []) {
      map.set(member.userId, formatTenantMemberDisplayName(member))
    }
    return map
  }, [tenantMembersResponse?.data])

  const resolveGeneratedByLabel = React.useCallback(
    (userId: string | null | undefined) => {
      if (!userId) return '—'
      return actorNameByUserId.get(userId) ?? userId
    },
    [actorNameByUserId],
  )

  const handleDownload = React.useCallback(
    async (
      exportId: string,
      expectedSha256?: string | null,
      filenameHint?: string,
    ) => {
      setIsDownloading(true)
      try {
        const { blob, filename } = await downloadAccountingExportCsv(
          exportId,
          expectedSha256 ?? undefined,
        )
        triggerBlobDownload(blob, filenameHint ?? filename)
        toast.success(t('accountingExport.toast.downloaded'), {
          description: t('accountingExport.toast.downloadedDescription'),
        })
      } catch (error: unknown) {
        if (getErrorStatus(error) === 422) {
          toast.error(t('accountingExport.toast.checksumMismatch'), {
            description: getErrorMessage(
              error,
              t('accountingExport.toast.checksumMismatchDescription'),
            ),
          })
          return
        }
        toast.error(getErrorMessage(error, t('accountingExport.toast.downloadFailed')))
      } finally {
        setIsDownloading(false)
      }
    },
    [t],
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

  React.useEffect(() => {
    if (profileSaveStatus === 'saved') {
      invalidatePreview()
    }
  }, [profileSaveStatus, invalidatePreview])

  const openSettingsTab = (tab: string) => {
    setSearchParams({ tab })
  }

  const handlePreview = async () => {
    if (!periodReady) {
      toast.error(t('accountingExport.toast.selectPeriod'))
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
        toast.message(t('accountingExport.toast.overlapDetected'), {
          description: t('accountingExport.toast.overlapDetectedDescription'),
        })
      }
    } catch (error: unknown) {
      setPreview(null)
      if (getErrorStatus(error) === 403) {
        setPreviewForbidden(true)
        toast.error(t('accountingExport.toast.previewForbidden'))
        return
      }
      toast.error(getErrorMessage(error, t('accountingExport.toast.previewFailed')))
    }
  }

  const runGenerate = async (withOverlapAck: boolean) => {
    if (!preview || !periodReady) {
      toast.error(t('accountingExport.toast.previewFirst'))
      return
    }
    if (profileSaveBlocking) {
      toast.error(t('accountingExport.toast.profileSaving'))
      return
    }
    if (!preview.canGenerate) {
      toast.error(t('accountingExport.toast.blocked'))
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
      toast.success(t('accountingExport.toast.generated'), {
        description: t('accountingExport.toast.generatedDescription', {
          documents: created.documentCount,
          hash: truncateHash(created.sha256),
        }),
      })
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('accountingExport.toast.generateFailed')))
    } finally {
      setOverlapDialogOpen(false)
    }
  }

  const historyRows = historyQuery.data?.data ?? []

  const columns = React.useMemo<ColumnDef<AccountingExportSummaryDto>[]>(
    () => [
      {
        accessorKey: 'legalEntityId',
        enableSorting: false,
        header: t('accountingExport.history.columns.legalEntity'),
        cell: ({ row }) =>
          entityNameById.get(row.original.legalEntityId) ??
          truncateHash(row.original.legalEntityId, 6),
      },
      {
        id: 'period',
        enableSorting: false,
        header: t('accountingExport.history.columns.period'),
        cell: ({ row }) =>
          `${formatIsoDateOnly(row.original.dateFrom)} → ${formatIsoDateOnly(row.original.dateTo)}`,
      },
      {
        accessorKey: 'documentCount',
        enableSorting: false,
        header: t('accountingExport.history.columns.documents'),
      },
      {
        accessorKey: 'createdAt',
        enableSorting: false,
        header: t('accountingExport.history.columns.created'),
        cell: ({ row }) => formatDateTime(row.original.createdAt),
      },
      {
        accessorKey: 'createdByUserId',
        enableSorting: false,
        header: t('accountingExport.history.columns.generatedBy'),
        cell: ({ row }) => resolveGeneratedByLabel(row.original.createdByUserId),
      },
      {
        accessorKey: 'sha256',
        enableSorting: false,
        header: t('accountingExport.history.columns.checksum'),
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
            {t('accountingExport.actions.download')}
          </Button>
        ),
      },
    ],
    [entityNameById, handleDownload, resolveGeneratedByLabel, t],
  )

  if (!canManageExports) {
    return (
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="flex items-start gap-3 text-slate-700">
          <AlertTriangle className="mt-0.5 h-5 w-5 text-amber-500" />
          <SettingsSectionHeading
            title={t('accountingExport.noAccess.title')}
            description={t('accountingExport.noAccess.description')}
            descriptionClassName="mt-1 text-sm text-slate-600"
          />
        </div>
      </div>
    )
  }

  if (isLoadingEntities) {
    return (
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <SettingsTabLoadingState className="min-h-[240px]" />
      </div>
    )
  }

  if (legalEntities.length === 0) {
    return (
      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <p className="text-sm text-slate-600">
          {t('accountingExport.noEntities.message')}
        </p>
        <Button
          type="button"
          variant="link"
          className="mt-2 h-auto px-0"
          onClick={() => openSettingsTab('legal-entities')}
        >
          {t('accountingExport.settingsLinks.legalEntities')}
        </Button>
      </div>
    )
  }

  return (
    <div className="space-y-6">
      <div className="flex flex-col gap-4 rounded-lg border bg-white p-6 shadow-sm lg:flex-row lg:items-start lg:justify-between">
        <div className="space-y-1">
          <SettingsSectionHeading title={t('accountingExport.header.title')} />
          <p className="max-w-2xl text-sm text-slate-600">
            <Trans
              t={t}
              i18nKey="accountingExport.header.description"
              values={{ profileCode: DATEV_PROFILE_CODE }}
              components={{ code: <span className="font-mono text-xs" /> }}
            />
          </p>
          {selectedEntity ? (
            <p className="text-sm text-slate-500">
              {periodReady ? (
                <Trans
                  t={t}
                  i18nKey="accountingExport.header.selectedPeriod"
                  values={{
                    name: selectedEntity.name,
                    from: formatIsoDateOnly(dateFrom),
                    to: formatIsoDateOnly(dateTo),
                  }}
                  components={{ name: <span className="font-medium text-slate-700" /> }}
                />
              ) : (
                <Trans
                  t={t}
                  i18nKey="accountingExport.header.selected"
                  values={{ name: selectedEntity.name }}
                  components={{ name: <span className="font-medium text-slate-700" /> }}
                />
              )}
            </p>
          ) : null}
        </div>
        <div className="flex flex-wrap items-center justify-end gap-2">
          <SettingsIconActionButton
            variant="outline"
            pending={previewMutation.isPending}
            idleIcon={<Search className="mr-2 h-4 w-4" />}
            label={t('accountingExport.actions.preview')}
            disabled={!periodReady}
            onClick={() => void handlePreview()}
          />
          <SettingsIconActionButton
            pending={generateMutation.isPending}
            idleIcon={<Play className="mr-2 h-4 w-4" />}
            label={t('accountingExport.actions.generate')}
            disabled={
              !preview?.canGenerate || profileSaveBlocking || previewMutation.isPending
            }
            onClick={() => void runGenerate(false)}
          />
          <SettingsIconActionButton
            variant="secondary"
            pending={isDownloading}
            idleIcon={<Download className="mr-2 h-4 w-4" />}
            label={t('accountingExport.actions.downloadLatest')}
            disabled={!lastGeneratedId}
            onClick={() => {
              if (!lastGeneratedId) return
              void handleDownload(lastGeneratedId, lastGeneratedSha256)
            }}
          />
        </div>
      </div>

      <div className="grid gap-4 rounded-lg border bg-white p-6 shadow-sm md:grid-cols-3">
        <div className="grid gap-2 md:col-span-1">
          <Label htmlFor="export-legal-entity">{t('accountingExport.filters.legalEntity')}</Label>
          <Select value={legalEntityId} onValueChange={setLegalEntityId}>
            <SelectTrigger id="export-legal-entity">
              <SelectValue placeholder={t('accountingExport.filters.selectEntity')} />
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
          <Label htmlFor="export-date-from">{t('accountingExport.filters.dateFrom')}</Label>
          <Input
            id="export-date-from"
            type="date"
            value={dateFrom}
            onChange={(event) => setDateFrom(event.target.value)}
          />
        </div>
        <div className="grid gap-2">
          <Label htmlFor="export-date-to">{t('accountingExport.filters.dateTo')}</Label>
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
          {t('accountingExport.forbidden')}
        </div>
      ) : null}

      {preview ? (
        <div className="space-y-4 rounded-lg border bg-white p-6 shadow-sm">
          <div className="flex flex-wrap items-center gap-3">
            <FileSpreadsheet className="h-5 w-5 text-slate-500" />
            <SettingsSubsectionIntro
              title={t('accountingExport.preview.title')}
              description={t('accountingExport.preview.summary', {
                version: preview.profileVersion,
                documents: formatNumber(preview.documentCount),
                rows: formatNumber(preview.rowCount),
              })}
              descriptionClassName="text-sm text-slate-500"
            />
            <StatusBadge status={preview.canGenerate ? 'ACTIVE' : 'INACTIVE'} />
          </div>

          {preview.blockers.length > 0 ? (
            <div className="space-y-2">
              <p className="text-sm font-medium text-slate-700">{t('accountingExport.preview.blockers')}</p>
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
                          {getBlockerSettingsLabel(settingsTab, t)}
                        </Button>
                      ) : null}
                    </li>
                  )
                })}
              </ul>
              <p className="text-xs text-slate-500">
                {t('accountingExport.preview.blockersNote')}
              </p>
            </div>
          ) : null}

          {preview.documentCount === 0 && preview.blockers.length === 0 ? (
            <p className="text-sm text-slate-600">
              {t('accountingExport.preview.emptyPeriod')}
            </p>
          ) : null}

          {preview.totals.length > 0 ? (
            <div className="overflow-x-auto">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>{t('accountingExport.preview.columns.account')}</TableHead>
                    <TableHead>{t('accountingExport.preview.columns.taxRate')}</TableHead>
                    <TableHead>{t('accountingExport.preview.columns.net')}</TableHead>
                    <TableHead>{t('accountingExport.preview.columns.tax')}</TableHead>
                    <TableHead>{t('accountingExport.preview.columns.gross')}</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {preview.totals.map((bucket) => (
                    <TableRow key={`${bucket.account}-${bucket.taxRate}`}>
                      <TableCell className="font-mono text-sm">{bucket.account}</TableCell>
                      <TableCell>{formatPercent(Number(bucket.taxRate))}</TableCell>
                      <TableCell>{formatCurrency(bucket.net)}</TableCell>
                      <TableCell>{formatCurrency(bucket.tax)}</TableCell>
                      <TableCell>{formatCurrency(bucket.gross)}</TableCell>
                    </TableRow>
                  ))}
                </TableBody>
              </Table>
            </div>
          ) : null}

          {preview.overlaps.length > 0 ? (
            <div className="rounded-md border border-amber-200 bg-amber-50 p-4 text-sm text-amber-950">
              <p className="font-medium">{t('accountingExport.overlap.title')}</p>
              <ul className="mt-2 list-disc space-y-1 pl-5">
                {preview.overlaps.map((overlap) => (
                  <li key={overlap.id}>
                    {t('accountingExport.overlap.item', {
                      from: formatIsoDateOnly(overlap.dateFrom),
                      to: formatIsoDateOnly(overlap.dateTo),
                      documents: formatNumber(overlap.documentCount),
                      createdAt: formatDateTime(overlap.createdAt),
                    })}{' '}
                    ·{' '}
                    <span className="font-mono text-xs">{truncateHash(overlap.fileSha256)}</span>
                  </li>
                ))}
              </ul>
              <p className="mt-2">
                {t('accountingExport.overlap.warning')}
              </p>
              <div className="mt-3 flex items-start gap-2">
                <Checkbox
                  id="export-overlap-ack"
                  checked={acknowledgeOverlap}
                  onCheckedChange={(checked) => setAcknowledgeOverlap(checked === true)}
                />
                <Label htmlFor="export-overlap-ack" className="font-normal leading-snug">
                  {t('accountingExport.overlap.acknowledge')}
                </Label>
              </div>
            </div>
          ) : null}
        </div>
      ) : null}

      <div className="rounded-lg border bg-white p-6 shadow-sm">
        <div className="mb-4 flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
          <SettingsSubsectionIntro
            title={t('accountingExport.history.title')}
            description={t('accountingExport.history.description')}
            descriptionClassName="text-sm text-slate-500"
          />
        </div>
        <DataTable
          columns={columns}
          data={historyRows}
          isLoading={historyQuery.isLoading}
          pageCount={historyQuery.data?.meta.pageCount ?? 1}
          searchPlaceholder={t('accountingExport.history.searchPlaceholder')}
          setPagination={setPagination}
          rowBehaviour={{ onRowClick: (row) => setSelectedRunId(row.id) }}
          emptyStateMessage={t('accountingExport.history.empty')}
          {...tableState}
        />
      </div>

      <Sheet open={Boolean(selectedRunId)} onOpenChange={(open) => !open && setSelectedRunId(null)}>
        <SheetContent className="w-full overflow-y-auto sm:max-w-lg">
          <SheetHeader>
            <SheetTitle>{t('accountingExport.detail.title')}</SheetTitle>
            <SheetDescription>
              {t('accountingExport.detail.description')}
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
                  <span className="text-slate-500">{t('accountingExport.detail.runId')}</span>{' '}
                  <span className="font-mono text-xs">{detailQuery.data.id}</span>
                </p>
                <p>
                  <span className="text-slate-500">{t('accountingExport.detail.period')}</span>{' '}
                  {formatIsoDateOnly(detailQuery.data.dateFrom)} →{' '}
                  {formatIsoDateOnly(detailQuery.data.dateTo)}
                </p>
                <p>
                  <span className="text-slate-500">{t('accountingExport.detail.documentsRows')}</span>{' '}
                  {formatNumber(detailQuery.data.documentCount)} / {formatNumber(detailQuery.data.rowCount)}
                </p>
                <p>
                  <span className="text-slate-500">{t('accountingExport.detail.generatedBy')}</span>{' '}
                  {resolveGeneratedByLabel(detailQuery.data.createdByUserId)}
                </p>
                <p>
                  <span className="text-slate-500">{t('accountingExport.detail.sha256')}</span>{' '}
                  <span className="break-all font-mono text-xs">{detailQuery.data.sha256}</span>
                </p>
                <p>
                  <span className="text-slate-500">{t('accountingExport.detail.created')}</span>{' '}
                  {formatDateTime(detailQuery.data.createdAt)}
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
                {t('accountingExport.actions.downloadCsv')}
              </Button>
              <p className="text-xs text-slate-500">
                {t('accountingExport.detail.downloadNote')}
              </p>
            </div>
          ) : (
            <div className="mt-6 flex items-center gap-2 text-sm text-slate-500">
              <Eye className="h-4 w-4" />
              {t('accountingExport.detail.selectRun')}
            </div>
          )}
        </SheetContent>
      </Sheet>

      <AlertDialog open={overlapDialogOpen} onOpenChange={setOverlapDialogOpen}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('accountingExport.overlap.dialogTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('accountingExport.overlap.dialogDescription')}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void runGenerate(true)}>
              {t('accountingExport.actions.generateAnyway')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  )
}
