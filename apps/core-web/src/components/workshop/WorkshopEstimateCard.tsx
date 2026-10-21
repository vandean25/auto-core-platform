import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import { toast } from 'sonner'
import { AlertTriangle, Download, Loader2, Plus, Send } from 'lucide-react'
import { EstimateSendDialog } from '@/components/workshop/EstimateSendDialog'
import { RecordEstimateDecisionDialog } from '@/components/workshop/RecordEstimateDecisionDialog'
import { RecordOverrunNoticeDialog } from '@/components/workshop/RecordOverrunNoticeDialog'
import type { EstimateSendCustomer } from '@/components/workshop/EstimateSendDialog'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  fetchWorkshopEstimatePdfError,
  workshopEstimateKeys,
  useCreateWorkshopEstimate,
  useRecordWorkshopEstimateDecision,
  useRecordWorkshopOverrunNotice,
  useReviseWorkshopEstimate,
  useSendWorkshopEstimateVersion,
  useWorkshopEstimateVersion,
  useWorkshopOrderEstimate,
  workshopEstimatePdfFilename,
  workshopEstimatePdfPath,
} from '@/api/workshop-estimates'
import type {
  RecordWorkshopEstimateDecisionBody,
  RecordWorkshopOverrunNoticeBody,
  WorkshopEstimate,
  WorkshopEstimateOverrunWarning,
  WorkshopEstimateStatus,
  WorkshopEstimateVersionSummary,
} from '@/api/workshop-estimates'
import { usePdfDownload } from '@/hooks/usePdfDownload'
import { getErrorMessage } from '@/lib/error-utils'
import { isWorkshopEstimateOrderOpen } from '@/features/workshop/workshop-estimate-permissions'
import {
  advisorChannelOptions,
  customerReactionOptions,
  describeApproval,
  estimateBadgeLabel,
  formatEstimateMoney,
} from '@/features/workshop/workshop-estimate-decision'
import { formatDateTime, formatPercent } from '@/lib/format'
import { i18n } from '@/lib/i18n'
import type { TFunction } from 'i18next'

/** The warning fields the overrun description reads. */
type DescribedOverrun = Pick<
  WorkshopEstimateOverrunWarning,
  'total_over_threshold' | 'new_work_lines' | 'approved_total_gross' | 'current_total_gross' | 'threshold_pct' | 'new_line_count'
>

function formatEstimateDateTime(value: string | null | undefined): string {
  return value ? formatDateTime(value) : '—'
}

function statusLabel(status: WorkshopEstimateStatus, t: TFunction<'workshop'>): string {
  return t(`estimateCard.status.${status}`)
}

/** The German label of a stored option value, or a dash when there is none. */
function optionLabel<T extends string>(
  options: ReadonlyArray<{ value: T; label: string }>,
  value: string | null | undefined,
): string {
  return options.find((option) => option.value === value)?.label ?? '—'
}

/** Overrun lines for the advisor. Threshold and amounts come from the backend overrun warning. */
export function describeEstimateOverrun(warning: DescribedOverrun): string[] {
  const t = i18n.getFixedT(i18n.language, 'workshop')
  const lines: string[] = []
  if (warning.total_over_threshold) {
    const approved = Number(warning.approved_total_gross)
    const current = Number(warning.current_total_gross)
    const percent = approved > 0 ? ((current - approved) / approved) * 100 : null
    const percentText = percent === null ? '' : ` (+${formatPercent(percent)})`
    lines.push(
      t('estimateCard.overrunTotalLine', {
        current: formatEstimateMoney(warning.current_total_gross),
        approved: formatEstimateMoney(warning.approved_total_gross),
        percentText,
        threshold: formatPercent(Number(warning.threshold_pct)),
      }),
    )
  }
  if (warning.new_work_lines) {
    lines.push(t('estimateCard.overrunNewLines', { count: warning.new_line_count }))
  }
  return lines
}

export interface WorkshopEstimateCardProps {
  orderId: string
  orderStatus: string
  isLocked: boolean
  /**
   * Changes whenever the order's tasks or lines change. The overrun warning and the
   * DRAFT totals depend on them, so the estimate is re-read when this value changes.
   */
  orderRevision?: string
  /** The order's customer. The send dialog shows its email and checks the contact confirmation. */
  customer?: EstimateSendCustomer | null
}

/** The newest version, which the advisor's controls act on. The backend returns the versions oldest first. */
function latestVersionOf(estimate: WorkshopEstimate | null): WorkshopEstimateVersionSummary | null {
  const versions = estimate?.versions ?? []
  return versions.length > 0 ? versions[versions.length - 1] : null
}

/** The overrun warning of the estimate, or null while none is loaded or none is flagged. */
function overrunOf(estimate: WorkshopEstimate | null): WorkshopEstimateOverrunWarning | null {
  return estimate?.overrun_warning ?? null
}

/** The customer is told about an overrun on an open order only, and only while the total is not yet told to them. */
function canNotifyCustomer(overrun: WorkshopEstimateOverrunWarning | null, orderStatus: string, isLocked: boolean): boolean {
  return !isLocked && orderStatus !== 'INVOICED' && overrun?.requires_customer_notice === true
}

/** The controls the advisor sees for one estimate. The backend enforces the same rules; this only mirrors them. */
function estimateControls(estimate: WorkshopEstimate | null, orderStatus: string, isLocked: boolean) {
  const latest = latestVersionOf(estimate)
  const canEdit = !isLocked && isWorkshopEstimateOrderOpen(orderStatus)
  return {
    latest,
    canEdit,
    sendFeatureEnabled: estimate?.send_enabled ?? false,
    customerSendBlockers: estimate?.customer_send_blockers ?? [],
    sendEnabled:
      (estimate?.send_enabled ?? false) &&
      (estimate?.customer_send_blockers?.length ?? 0) === 0,
    canCreate: canEdit && estimate === null,
    canRevise: canEdit && latest !== null && latest.status !== 'DRAFT',
    canRecordDecision: canEdit && latest?.status === 'SENT',
    canNotifyOverrun: canNotifyCustomer(overrunOf(estimate), orderStatus, isLocked),
  }
}

/** The total of the open draft, live from its preview. A sent version has a fixed total and needs no read. */
function useLiveDraftTotal(latest: WorkshopEstimateVersionSummary | null): string | null {
  const draftId = latest?.status === 'DRAFT' ? latest.id : null
  const draftQuery = useWorkshopEstimateVersion(draftId)
  return draftQuery.data?.draft_preview?.totals.total_gross ?? null
}

interface EstimateHeaderProps {
  estimate: WorkshopEstimate | null
  latest: WorkshopEstimateVersionSummary | null
  canCreate: boolean
  canRevise: boolean
  busy: boolean
  onCreate: () => void
  onRevise: () => void
}

function EstimateHeader({ estimate, latest, canCreate, canRevise, busy, onCreate, onRevise }: EstimateHeaderProps) {
  const { t } = useTranslation('workshop')
  return (
    <CardHeader className='flex flex-row items-start justify-between gap-3 space-y-0 pb-3'>
      <div className='min-w-0'>
        <CardTitle className='text-base font-semibold'>{t('estimateCard.title')}</CardTitle>
        {estimate && <p className='text-xs text-slate-500'>{estimate.estimate_number}</p>}
        {latest && (
          <span data-testid='estimate-derived-badge' className='mt-1 inline-block'>
            <StatusBadge status={latest.status} label={estimateBadgeLabel(latest.status)} />
          </span>
        )}
      </div>
      {canCreate && (
        <Button size='sm' onClick={onCreate} disabled={busy}>
          <Plus className='h-4 w-4 mr-2' />
          {t('estimateCard.create')}
        </Button>
      )}
      {canRevise && (
        <Button size='sm' variant='outline' onClick={onRevise} disabled={busy}>
          <Plus className='h-4 w-4 mr-2' />
          {t('estimateCard.newVersion')}
        </Button>
      )}
    </CardHeader>
  )
}

interface EstimateLoadStateProps {
  isLoading: boolean
  isError: boolean
  error: unknown
  hasEstimate: boolean
  canEdit: boolean
}

/** Loading, failure, or the empty state when the order has no estimate yet. Nothing when an estimate is shown. */
function EstimateLoadState({ isLoading, isError, error, hasEstimate, canEdit }: EstimateLoadStateProps) {
  const { t } = useTranslation('workshop')
  if (isLoading) {
    return <p className='text-sm text-slate-500'>{t('estimateCard.loading')}</p>
  }
  if (isError) {
    return (
      <Alert variant='destructive'>
        <AlertTitle as='h3'>{t('estimateCard.loadErrorTitle')}</AlertTitle>
        <AlertDescription>{getErrorMessage(error, t('estimateCard.loadErrorFallback'))}</AlertDescription>
      </Alert>
    )
  }
  if (hasEstimate) {
    return null
  }
  return (
    <p className='text-sm text-slate-500'>
      {canEdit ? t('estimateCard.emptyEditable') : t('estimateCard.emptyReadonly')}
    </p>
  )
}

/** The notice the customer got: when, by which channel, how they reacted, and the advisor's note (AUT-355). */
function OverrunNoticeLine({ overrun }: { overrun: WorkshopEstimateOverrunWarning }) {
  const { t } = useTranslation('workshop')
  const channel = optionLabel(advisorChannelOptions(), overrun.notified_channel)
  const reaction = optionLabel(customerReactionOptions(), overrun.customer_reaction)
  const note = overrun.note ? t('estimateCard.overrunNoticeNote', { note: overrun.note }) : ''
  return (
    <p className='mt-2 text-xs' data-testid='estimate-overrun-notice'>
      {t('estimateCard.overrunNoticeLine', {
        date: formatEstimateDateTime(overrun.notified_at),
        channel,
        reaction,
        note,
      })}
    </p>
  )
}

interface EstimateOverrunBannerProps {
  overrun: WorkshopEstimateOverrunWarning | null
  canNotify: boolean
  canReviseAndSend: boolean
  busy: boolean
  onNotify: () => void
  onReviseAndSend: () => void
}

/** The overrun against the approved estimate, with the two answers to it: tell the customer, or send a revised estimate. */
function EstimateOverrunBanner({
  overrun,
  canNotify,
  canReviseAndSend,
  busy,
  onNotify,
  onReviseAndSend,
}: EstimateOverrunBannerProps) {
  const { t } = useTranslation('workshop')
  const lines = overrun ? describeEstimateOverrun(overrun) : []
  if (!overrun || lines.length === 0) {
    return null
  }
  return (
    <Alert className='border-amber-300 bg-amber-50 text-amber-900 [&>svg]:text-amber-700' data-testid='estimate-overrun-banner'>
      <AlertTriangle className='h-4 w-4' />
      <AlertTitle as='h3'>{t('estimateCard.overrunBannerTitle')}</AlertTitle>
      <AlertDescription>
        <ul className='list-disc pl-4 space-y-1'>
          {lines.map((line) => (
            <li key={line}>{line}</li>
          ))}
        </ul>
        {overrun.notified_at && <OverrunNoticeLine overrun={overrun} />}
        <div className='mt-3 flex flex-wrap gap-2'>
          {canNotify && (
            <Button size='sm' variant='outline' onClick={onNotify}>
              {t('estimateCard.notifyCustomer')}
            </Button>
          )}
          {canReviseAndSend && (
            <Button size='sm' variant='outline' onClick={onReviseAndSend} disabled={busy}>
              <Send className='h-4 w-4 mr-2' />
              {t('estimateCard.reviseAndSend')}
            </Button>
          )}
        </div>
      </AlertDescription>
    </Alert>
  )
}

/** The line under a version number: a draft says so, a sent version says when it went out and until when it is valid. */
function versionSubline(version: WorkshopEstimateVersionSummary, t: TFunction<'workshop'>): string {
  if (version.status === 'DRAFT') {
    return t('estimateCard.versionDraftSubline')
  }
  return t('estimateCard.versionSentSubline', {
    sent: formatEstimateDateTime(version.sent_at),
    validUntil: formatEstimateDateTime(version.valid_until),
  })
}

/** The gross total of a version. A draft shows the live preview, since its total is not fixed until it is sent. */
function VersionTotal({ version, liveDraftTotal }: { version: WorkshopEstimateVersionSummary; liveDraftTotal: string | null }) {
  const { t } = useTranslation('workshop')
  if (version.status !== 'DRAFT') {
    return (
      <span className='text-sm tabular-nums'>
        {t('estimateCard.gross', { amount: formatEstimateMoney(version.total_gross) })}
      </span>
    )
  }
  return (
    <span className='text-sm tabular-nums'>
      {t('estimateCard.gross', { amount: formatEstimateMoney(liveDraftTotal) })}
      <span className='ml-1 text-xs text-slate-500'>{t('estimateCard.preview')}</span>
    </span>
  )
}

function SendVersionButton({ canSend, onSend }: { canSend: boolean; onSend: () => void }) {
  const { t } = useTranslation('workshop')
  return (
    <Button
      size='sm'
      variant='outline'
      onClick={onSend}
      disabled={!canSend}
      title={canSend ? undefined : t('estimateCard.sendDisabledTitle')}
    >
      <Send className='h-4 w-4 mr-2' />
      {t('estimateCard.sendToCustomer')}
    </Button>
  )
}

function DownloadVersionButton({
  isDownloading,
  isDownloadBusy,
  onDownload,
}: {
  isDownloading: boolean
  isDownloadBusy: boolean
  onDownload: () => void
}) {
  const { t } = useTranslation('workshop')
  return (
    <Button size='sm' variant='outline' onClick={onDownload} disabled={isDownloadBusy}>
      {isDownloading ? <Loader2 className='h-4 w-4 mr-2 animate-spin' /> : <Download className='h-4 w-4 mr-2' />}
      {isDownloading ? t('estimateCard.pdfGenerating') : t('estimateCard.pdfDownload')}
    </Button>
  )
}

interface VersionRowProps {
  version: WorkshopEstimateVersionSummary
  isLatest: boolean
  liveDraftTotal: string | null
  canSend: boolean
  canRecordDecision: boolean
  isDownloading: boolean
  isDownloadBusy: boolean
  onSend: () => void
  onRecordDecision: () => void
  onDownload: () => void
}

function VersionRow({
  version,
  isLatest,
  liveDraftTotal,
  canSend,
  canRecordDecision,
  isDownloading,
  isDownloadBusy,
  onSend,
  onRecordDecision,
  onDownload,
}: VersionRowProps) {
  const { t } = useTranslation('workshop')
  const isDraft = version.status === 'DRAFT'

  return (
    <li className='flex flex-wrap items-center justify-between gap-3 p-3' data-testid={`estimate-version-${version.version}`}>
      <div className='min-w-0 space-y-1'>
        <div className='flex items-center gap-2'>
          <span className='text-sm font-medium'>{t('estimateCard.versionLabel', { version: version.version })}</span>
          <StatusBadge status={version.status} label={statusLabel(version.status, t)} />
        </div>
        <p className='text-xs text-slate-500'>{versionSubline(version, t)}</p>
        {version.approval && (
          <p className='text-xs text-slate-600' data-testid={`estimate-approval-${version.version}`}>
            {describeApproval(version.approval)}
            {version.approval.note ? t('estimateCard.approvalNote', { note: version.approval.note }) : ''}
          </p>
        )}
        {version.pdf_generation_error && (
          <p className='text-xs text-destructive' role='alert'>
            {version.pdf_generation_error}
          </p>
        )}
      </div>

      <div className='flex items-center gap-4'>
        <VersionTotal version={version} liveDraftTotal={liveDraftTotal} />
        {isDraft && isLatest && <SendVersionButton canSend={canSend} onSend={onSend} />}
        {canRecordDecision && (
          <Button size='sm' variant='outline' onClick={onRecordDecision}>
            {t('estimateCard.recordDecision')}
          </Button>
        )}
        {!isDraft && (
          <DownloadVersionButton isDownloading={isDownloading} isDownloadBusy={isDownloadBusy} onDownload={onDownload} />
        )}
      </div>
    </li>
  )
}

interface EstimateVersionsProps {
  /** Oldest first, as the backend returns them. The list shows the newest first. */
  versions: WorkshopEstimateVersionSummary[]
  latest: WorkshopEstimateVersionSummary | null
  liveDraftTotal: string | null
  canEdit: boolean
  sendEnabled: boolean
  sendFeatureEnabled: boolean
  customerSendBlockerCount: number
  canRecordDecision: boolean
  busy: boolean
  downloadingVersionId: string | null
  onRecordDecision: (version: WorkshopEstimateVersionSummary) => void
  onSend: (version: WorkshopEstimateVersionSummary) => void
  onDownload: (version: WorkshopEstimateVersionSummary) => void
}

function EstimateVersions({
  versions,
  latest,
  liveDraftTotal,
  canEdit,
  sendEnabled,
  sendFeatureEnabled,
  customerSendBlockerCount,
  canRecordDecision,
  busy,
  downloadingVersionId,
  onRecordDecision,
  onSend,
  onDownload,
}: EstimateVersionsProps) {
  const { t } = useTranslation('workshop')
  const newestFirst = [...versions].reverse()
  const latestIsDraft = latest?.status === 'DRAFT'

  return (
    <>
      {latestIsDraft && !sendFeatureEnabled && (
        <p className='text-sm text-slate-600'>{t('estimateCard.sendDisabledLegal')}</p>
      )}
      {latestIsDraft && sendFeatureEnabled && customerSendBlockerCount > 0 && (
        <p className='text-sm text-amber-800' data-testid='estimate-customer-send-blockers'>
          {t('estimateCard.sendBlocked', { count: customerSendBlockerCount })}
        </p>
      )}

      {newestFirst.length > 0 && (
        <ul className='divide-y rounded-md border'>
          {newestFirst.map((version) => (
            <VersionRow
              key={version.id}
              version={version}
              isLatest={version.id === latest?.id}
              liveDraftTotal={liveDraftTotal}
              canSend={canEdit && sendEnabled && version.id === latest?.id && !busy}
              canRecordDecision={canRecordDecision && version.id === latest?.id && !busy}
              onRecordDecision={() => onRecordDecision(version)}
              isDownloading={downloadingVersionId === version.id}
              isDownloadBusy={downloadingVersionId !== null}
              onSend={() => onSend(version)}
              onDownload={() => onDownload(version)}
            />
          ))}
        </ul>
      )}
    </>
  )
}

/**
 * Advisor card for the Kostenvoranschlag on a workshop order. The page renders it
 * only for OWNER, ADMIN and SALES. The backend enforces the same roles, the open-order
 * rule and the send flag; this card mirrors them so the advisor sees the right controls.
 */
export function WorkshopEstimateCard({
  orderId,
  orderStatus,
  isLocked,
  orderRevision,
  customer = null,
}: WorkshopEstimateCardProps) {
  const { t } = useTranslation('workshop')
  const queryClient = useQueryClient()
  const lastOrderRevision = useRef(orderRevision)
  useEffect(() => {
    if (lastOrderRevision.current === orderRevision) return
    lastOrderRevision.current = orderRevision
    void queryClient.invalidateQueries({ queryKey: workshopEstimateKeys.all })
  }, [orderRevision, queryClient])

  const estimateQuery = useWorkshopOrderEstimate(orderId)
  const estimate = estimateQuery.data ?? null
  const {
    latest,
    canEdit,
    sendEnabled,
    sendFeatureEnabled,
    customerSendBlockers,
    canCreate,
    canRevise,
    canRecordDecision,
    canNotifyOverrun,
  } = estimateControls(
    estimate,
    orderStatus,
    isLocked,
  )
  const liveDraftTotal = useLiveDraftTotal(latest)

  const createEstimate = useCreateWorkshopEstimate()
  const reviseEstimate = useReviseWorkshopEstimate()
  const sendVersion = useSendWorkshopEstimateVersion()
  const pdfDownload = usePdfDownload({
    messages: {
      success: t('estimateCard.toast.pdfDownloaded'),
      errorFallback: t('estimateCard.toast.pdfFailed'),
    },
  })

  const [downloadingVersionId, setDownloadingVersionId] = useState<string | null>(null)
  const [sendTarget, setSendTarget] = useState<WorkshopEstimateVersionSummary | null>(null)
  const [decisionTarget, setDecisionTarget] = useState<WorkshopEstimateVersionSummary | null>(null)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const recordDecision = useRecordWorkshopEstimateDecision()
  const recordNotice = useRecordWorkshopOverrunNotice()

  const busy = createEstimate.isPending || reviseEstimate.isPending || sendVersion.isPending
  const overrun = overrunOf(estimate)

  const handleCreate = async () => {
    try {
      await createEstimate.mutateAsync(orderId)
      toast.success(t('estimateCard.toast.created'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('estimateCard.toast.createFailed')))
    }
  }

  const handleRevise = async () => {
    try {
      await reviseEstimate.mutateAsync(orderId)
      toast.success(t('estimateCard.toast.revised'))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('estimateCard.toast.reviseFailed')))
    }
  }

  /** Creates the next version and opens its send dialog, so an overrun is answered in one step. */
  const handleReviseAndSend = async () => {
    try {
      setSendTarget(await reviseEstimate.mutateAsync(orderId))
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, t('estimateCard.toast.reviseFailed')))
    }
  }

  /** Rejects with the API error: the decision dialog stays open and shows the safe message. */
  const handleRecordDecision = async (body: RecordWorkshopEstimateDecisionBody) => {
    if (!decisionTarget) return
    await recordDecision.mutateAsync({ orderId, versionId: decisionTarget.id, body })
    setDecisionTarget(null)
    toast.success(t('estimateCard.toast.decisionRecorded', { version: decisionTarget.version }))
  }

  /** Rejects with the API error: the notice dialog stays open and shows the safe message. */
  const handleRecordNotice = async (body: RecordWorkshopOverrunNoticeBody) => {
    await recordNotice.mutateAsync({ orderId, body })
    setNoticeOpen(false)
    toast.success(t('estimateCard.toast.noticeRecorded'))
  }

  /** Rejects with the API error: the send dialog stays open and shows it. */
  const handleSend = async (version: WorkshopEstimateVersionSummary, notifyCustomerByEmail: boolean) => {
    await sendVersion.mutateAsync({ orderId, versionId: version.id, notifyCustomerByEmail })
    setSendTarget(null)
    toast.success(
      notifyCustomerByEmail
        ? t('estimateCard.toast.sentWithEmail', { version: version.version })
        : t('estimateCard.toast.sent', { version: version.version }),
    )
  }

  const handleDownload = async (version: WorkshopEstimateVersionSummary) => {
    // A DRAFT has no archive. The backend refuses it, and the card never asks for it.
    if (!estimate || version.status === 'DRAFT') return
    setDownloadingVersionId(version.id)
    try {
      await pdfDownload.download({
        postUrl: workshopEstimatePdfPath(version.id),
        getUrl: workshopEstimatePdfPath(version.id),
        filename: workshopEstimatePdfFilename(estimate.estimate_number, version.version),
        checkGenerationFailed: () => fetchWorkshopEstimatePdfError(version.id),
      })
    } finally {
      setDownloadingVersionId(null)
    }
  }

  return (
    <Card>
      <EstimateHeader
        estimate={estimate}
        latest={latest}
        canCreate={canCreate}
        canRevise={canRevise}
        busy={busy}
        onCreate={() => void handleCreate()}
        onRevise={() => void handleRevise()}
      />

      <CardContent className='space-y-4'>
        <EstimateLoadState
          isLoading={estimateQuery.isLoading}
          isError={estimateQuery.isError}
          error={estimateQuery.error}
          hasEstimate={estimate !== null}
          canEdit={canEdit}
        />

        <EstimateOverrunBanner
          overrun={overrun}
          canNotify={canNotifyOverrun}
          canReviseAndSend={canRevise && sendEnabled}
          busy={busy}
          onNotify={() => setNoticeOpen(true)}
          onReviseAndSend={() => void handleReviseAndSend()}
        />

        <EstimateVersions
          versions={estimate?.versions ?? []}
          latest={latest}
          liveDraftTotal={liveDraftTotal}
          canEdit={canEdit}
          sendEnabled={sendEnabled}
          sendFeatureEnabled={sendFeatureEnabled}
          customerSendBlockerCount={customerSendBlockers.length}
          canRecordDecision={canRecordDecision}
          busy={busy}
          downloadingVersionId={downloadingVersionId}
          onRecordDecision={setDecisionTarget}
          onSend={setSendTarget}
          onDownload={(version) => void handleDownload(version)}
        />
      </CardContent>

      <RecordEstimateDecisionDialog
        version={decisionTarget}
        onSubmit={handleRecordDecision}
        onClose={() => setDecisionTarget(null)}
      />

      <RecordOverrunNoticeDialog
        warning={noticeOpen ? overrun : null}
        onSubmit={handleRecordNotice}
        onClose={() => setNoticeOpen(false)}
      />

      <EstimateSendDialog
        version={sendTarget}
        customer={customer}
        isSending={sendVersion.isPending}
        onSend={handleSend}
        onClose={() => setSendTarget(null)}
      />
    </Card>
  )
}
