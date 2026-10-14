import { useEffect, useRef, useState } from 'react'
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
  WorkshopEstimateOverrunWarning,
  WorkshopEstimateStatus,
  WorkshopEstimateVersionSummary,
} from '@/api/workshop-estimates'
import { usePdfDownload } from '@/hooks/usePdfDownload'
import { getErrorMessage } from '@/lib/error-utils'
import { isWorkshopEstimateOrderOpen } from '@/features/workshop/workshop-estimate-permissions'
import {
  ADVISOR_CHANNEL_OPTIONS,
  CUSTOMER_REACTION_OPTIONS,
  describeApproval,
  estimateBadgeLabel,
  formatEstimateMoney,
} from '@/features/workshop/workshop-estimate-decision'

/** The warning fields the overrun description reads. */
type DescribedOverrun = Pick<
  WorkshopEstimateOverrunWarning,
  'total_over_threshold' | 'new_work_lines' | 'approved_total_gross' | 'current_total_gross' | 'threshold_pct' | 'new_line_count'
>

const STATUS_LABEL: Record<WorkshopEstimateStatus, string> = {
  DRAFT: 'Entwurf',
  SENT: 'Gesendet',
  APPROVED: 'Freigegeben',
  DECLINED: 'Abgelehnt',
  EXPIRED: 'Abgelaufen',
  SUPERSEDED: 'Ersetzt',
}

const percentFormat = new Intl.NumberFormat('de-AT', { maximumFractionDigits: 1 })
const dateTimeFormat = new Intl.DateTimeFormat('de-AT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Vienna',
})

export { formatEstimateMoney }

function formatEstimateDateTime(value: string | null | undefined): string {
  return value ? `${dateTimeFormat.format(new Date(value))} Uhr` : '—'
}

/** Overrun lines for the advisor. Threshold and amounts come from the backend overrun warning. */
export function describeEstimateOverrun(warning: DescribedOverrun): string[] {
  const lines: string[] = []
  if (warning.total_over_threshold) {
    const approved = Number(warning.approved_total_gross)
    const current = Number(warning.current_total_gross)
    const percent = approved > 0 ? ((current - approved) / approved) * 100 : null
    const percentText = percent === null ? '' : ` (+${percentFormat.format(percent)} %)`
    lines.push(
      `Gesamtbetrag brutto ${formatEstimateMoney(warning.current_total_gross)} liegt über dem freigegebenen Betrag ${formatEstimateMoney(warning.approved_total_gross)}${percentText}. Grenzwert: ${percentFormat.format(Number(warning.threshold_pct))} %.`,
    )
  }
  if (warning.new_work_lines) {
    lines.push(`${warning.new_line_count} neue Position(en) gegenüber dem freigegebenen Kostenvoranschlag.`)
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
  const isDraft = version.status === 'DRAFT'
  const subline = isDraft
    ? 'Entwurf · noch nicht gesendet'
    : `Gesendet ${formatEstimateDateTime(version.sent_at)} · gültig bis ${formatEstimateDateTime(version.valid_until)}`

  return (
    <li className='flex flex-wrap items-center justify-between gap-3 p-3' data-testid={`estimate-version-${version.version}`}>
      <div className='min-w-0 space-y-1'>
        <div className='flex items-center gap-2'>
          <span className='text-sm font-medium'>Version {version.version}</span>
          <StatusBadge status={version.status} label={STATUS_LABEL[version.status]} />
        </div>
        <p className='text-xs text-slate-500'>{subline}</p>
        {version.approval && (
          <p className='text-xs text-slate-600' data-testid={`estimate-approval-${version.version}`}>
            {describeApproval(version.approval)}
            {version.approval.note ? ` · Notiz: ${version.approval.note}` : ''}
          </p>
        )}
        {version.pdf_generation_error && (
          <p className='text-xs text-destructive' role='alert'>
            {version.pdf_generation_error}
          </p>
        )}
      </div>

      <div className='flex items-center gap-4'>
        <span className='text-sm tabular-nums'>
          {isDraft ? (
            <>
              Brutto {formatEstimateMoney(liveDraftTotal)}
              <span className='ml-1 text-xs text-slate-500'>(Vorschau)</span>
            </>
          ) : (
            <>Brutto {formatEstimateMoney(version.total_gross)}</>
          )}
        </span>

        {isDraft && isLatest && (
          <Button
            size='sm'
            variant='outline'
            onClick={onSend}
            disabled={!canSend}
            title={canSend ? undefined : 'Versand an Kunden derzeit nicht verfügbar'}
          >
            <Send className='h-4 w-4 mr-2' />
            An Kunden senden
          </Button>
        )}

        {canRecordDecision && (
          <Button size='sm' variant='outline' onClick={onRecordDecision}>
            Bestätigung erfassen
          </Button>
        )}

        {!isDraft && (
          <Button size='sm' variant='outline' onClick={onDownload} disabled={isDownloadBusy}>
            {isDownloading ? (
              <Loader2 className='h-4 w-4 mr-2 animate-spin' />
            ) : (
              <Download className='h-4 w-4 mr-2' />
            )}
            {isDownloading ? 'PDF wird erstellt…' : 'PDF herunterladen'}
          </Button>
        )}
      </div>
    </li>
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
  const queryClient = useQueryClient()
  const lastOrderRevision = useRef(orderRevision)
  useEffect(() => {
    if (lastOrderRevision.current === orderRevision) return
    lastOrderRevision.current = orderRevision
    void queryClient.invalidateQueries({ queryKey: workshopEstimateKeys.all })
  }, [orderRevision, queryClient])

  const estimateQuery = useWorkshopOrderEstimate(orderId)
  const estimate = estimateQuery.data ?? null
  const versions = estimate?.versions ?? []
  const latest = versions.length > 0 ? versions[versions.length - 1] : null
  const latestDraft = latest?.status === 'DRAFT' ? latest : null
  const draftQuery = useWorkshopEstimateVersion(latestDraft?.id ?? null)

  const createEstimate = useCreateWorkshopEstimate()
  const reviseEstimate = useReviseWorkshopEstimate()
  const sendVersion = useSendWorkshopEstimateVersion()
  const pdfDownload = usePdfDownload({
    messages: {
      success: 'Kostenvoranschlag-PDF heruntergeladen',
      errorFallback: 'PDF-Erstellung fehlgeschlagen',
    },
  })

  const [downloadingVersionId, setDownloadingVersionId] = useState<string | null>(null)
  const [sendTarget, setSendTarget] = useState<WorkshopEstimateVersionSummary | null>(null)
  const [decisionTarget, setDecisionTarget] = useState<WorkshopEstimateVersionSummary | null>(null)
  const [noticeOpen, setNoticeOpen] = useState(false)
  const recordDecision = useRecordWorkshopEstimateDecision()
  const recordNotice = useRecordWorkshopOverrunNotice()

  const canEdit = !isLocked && isWorkshopEstimateOrderOpen(orderStatus)
  const sendEnabled = estimate?.send_enabled ?? false
  const canCreate = canEdit && estimate === null
  const canRevise = canEdit && latest !== null && latest.status !== 'DRAFT'
  const busy = createEstimate.isPending || reviseEstimate.isPending || sendVersion.isPending
  const overrun = estimate?.overrun_warning ?? null
  const overrunLines =
    overrun && (overrun.total_over_threshold || overrun.new_work_lines) ? describeEstimateOverrun(overrun) : []
  const newestFirst = [...versions].reverse()
  const canRecordDecision = canEdit && latest?.status === 'SENT'
  const canNotifyOverrun = !isLocked && orderStatus !== 'INVOICED' && overrun?.requires_customer_notice === true
  const liveDraftTotal = draftQuery.data?.draft_preview?.totals.total_gross ?? null

  const handleCreate = async () => {
    try {
      await createEstimate.mutateAsync(orderId)
      toast.success('Kostenvoranschlag erstellt')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Kostenvoranschlag konnte nicht erstellt werden.'))
    }
  }

  const handleRevise = async () => {
    try {
      await reviseEstimate.mutateAsync(orderId)
      toast.success('Neue Version als Entwurf erstellt')
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Neue Version konnte nicht erstellt werden.'))
    }
  }

  /** Rejects with the API error: the decision dialog stays open and shows the safe message. */
  const handleRecordDecision = async (body: RecordWorkshopEstimateDecisionBody) => {
    if (!decisionTarget) return
    await recordDecision.mutateAsync({ orderId, versionId: decisionTarget.id, body })
    setDecisionTarget(null)
    toast.success(`Bestätigung zu Version ${decisionTarget.version} erfasst`)
  }

  /** Rejects with the API error: the notice dialog stays open and shows the safe message. */
  const handleRecordNotice = async (body: RecordWorkshopOverrunNoticeBody) => {
    await recordNotice.mutateAsync({ orderId, body })
    setNoticeOpen(false)
    toast.success('Mitteilung an den Kunden erfasst')
  }

  /** Rejects with the API error: the send dialog stays open and shows it. */
  const handleSend = async (version: WorkshopEstimateVersionSummary, notifyCustomerByEmail: boolean) => {
    await sendVersion.mutateAsync({ orderId, versionId: version.id, notifyCustomerByEmail })
    setSendTarget(null)
    toast.success(
      notifyCustomerByEmail
        ? `Version ${version.version} gesendet, die E-Mail an den Kunden wird versendet`
        : `Version ${version.version} gesendet`,
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
      <CardHeader className='flex flex-row items-start justify-between gap-3 space-y-0 pb-3'>
        <div className='min-w-0'>
          <CardTitle className='text-base font-semibold'>Kostenvoranschlag</CardTitle>
          {estimate && <p className='text-xs text-slate-500'>{estimate.estimate_number}</p>}
          {latest && (
            <span data-testid='estimate-derived-badge' className='mt-1 inline-block'>
              <StatusBadge status={latest.status} label={estimateBadgeLabel(latest.status)} />
            </span>
          )}
        </div>
        {canCreate && (
          <Button size='sm' onClick={() => void handleCreate()} disabled={busy}>
            <Plus className='h-4 w-4 mr-2' />
            Kostenvoranschlag erstellen
          </Button>
        )}
        {canRevise && (
          <Button size='sm' variant='outline' onClick={() => void handleRevise()} disabled={busy}>
            <Plus className='h-4 w-4 mr-2' />
            Neue Version erstellen
          </Button>
        )}
      </CardHeader>

      <CardContent className='space-y-4'>
        {estimateQuery.isLoading && <p className='text-sm text-slate-500'>Wird geladen…</p>}

        {estimateQuery.isError && (
          <Alert variant='destructive'>
            <AlertTitle as='h3'>Kostenvoranschlag nicht verfügbar</AlertTitle>
            <AlertDescription>
              {getErrorMessage(estimateQuery.error, 'Kostenvoranschlag konnte nicht geladen werden.')}
            </AlertDescription>
          </Alert>
        )}

        {!estimateQuery.isLoading && !estimateQuery.isError && estimate === null && (
          <p className='text-sm text-slate-500'>
            {canEdit
              ? 'Noch kein Kostenvoranschlag für diesen Auftrag.'
              : 'Für diesen Auftrag wurde kein Kostenvoranschlag erstellt.'}
          </p>
        )}

        {overrunLines.length > 0 && (
          <Alert className='border-amber-300 bg-amber-50 text-amber-900 [&>svg]:text-amber-700' data-testid='estimate-overrun-banner'>
            <AlertTriangle className='h-4 w-4' />
            <AlertTitle as='h3'>Auftrag weicht vom Kostenvoranschlag ab</AlertTitle>
            <AlertDescription>
              <ul className='list-disc pl-4 space-y-1'>
                {overrunLines.map((line) => (
                  <li key={line}>{line}</li>
                ))}
              </ul>
              {overrun?.notified_at && (
                <p className='mt-2 text-xs' data-testid='estimate-overrun-notice'>
                  Kunde informiert am {formatEstimateDateTime(overrun.notified_at)} ·{' '}
                  {ADVISOR_CHANNEL_OPTIONS.find((option) => option.value === overrun.notified_channel)?.label ?? '—'} ·
                  Reaktion: {CUSTOMER_REACTION_OPTIONS.find((option) => option.value === overrun.customer_reaction)?.label ?? '—'}
                  {overrun.note ? ` · Notiz: ${overrun.note}` : ''}
                </p>
              )}
              <div className='mt-3 flex flex-wrap gap-2'>
                {canNotifyOverrun && (
                  <Button size='sm' variant='outline' onClick={() => setNoticeOpen(true)}>
                    Kunden informiert
                  </Button>
                )}
                {canRevise && (
                  <Button size='sm' variant='outline' onClick={() => void handleRevise()} disabled={busy}>
                    <Plus className='h-4 w-4 mr-2' />
                    Neue Version vorbereiten
                  </Button>
                )}
              </div>
            </AlertDescription>
          </Alert>
        )}

        {latestDraft && !sendEnabled && (
          <p className='text-sm text-slate-600'>
            Der Versand an Kunden ist derzeit deaktiviert, bis die rechtlichen Texte freigegeben sind. Der Entwurf
            kann bis dahin geprüft werden.
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
                onRecordDecision={() => setDecisionTarget(version)}
                isDownloading={downloadingVersionId === version.id}
                isDownloadBusy={downloadingVersionId !== null}
                onSend={() => setSendTarget(version)}
                onDownload={() => void handleDownload(version)}
              />
            ))}
          </ul>
        )}
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

export default WorkshopEstimateCard
