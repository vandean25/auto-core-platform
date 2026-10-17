import { AlertTriangle, CheckCircle2, Loader2, Mail, XCircle } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { useWorkshopOrderCommunications } from '@/api/workshop-communications'
import type { WorkshopOrderCommunication } from '@/api/workshop-communications'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/format'
import { i18n } from '@/lib/i18n'
import type { TFunction } from 'i18next'

function channelSuffix(channel: string | null, t: TFunction<'workshop'>): string {
  if (!channel) return ''
  const label = t(`communicationTimeline.channel.${channel}`, { defaultValue: '' })
  return label ? t('communicationTimeline.channelSuffix', { label }) : ''
}

interface EstimateWording {
  nominative: string
  accusative: string
  dative: string
  genitive: string
}

function estimateWording(version: number | null, t: TFunction<'workshop'>): EstimateWording {
  const suffix =
    version === null
      ? ''
      : t('communicationTimeline.estimateVersionSuffix', { version })
  return {
    nominative: t('communicationTimeline.estimateNoun.nominative', { suffix }),
    accusative: t('communicationTimeline.estimateNoun.accusative', { suffix }),
    dative: t('communicationTimeline.estimateNoun.dative', { suffix }),
    genitive: t('communicationTimeline.estimateNoun.genitive', { suffix }),
  }
}

function describeReadyEmail(entry: WorkshopOrderCommunication, t: TFunction<'workshop'>): string {
  switch (entry.status) {
    case 'QUEUED':
    case 'SENT':
    case 'FAILED':
    case 'SUPPRESSED':
      return t(`communicationTimeline.readyEmail.${entry.status}`)
    default:
      return t('communicationTimeline.readyEmail.default')
  }
}

function describeEstimateEmail(
  entry: WorkshopOrderCommunication,
  wording: EstimateWording,
  t: TFunction<'workshop'>,
): string {
  const status = entry.status
  if (status === 'QUEUED' || status === 'SENT' || status === 'FAILED' || status === 'SUPPRESSED') {
    return t(`communicationTimeline.estimateEmail.${status}`, {
      nominative: wording.nominative,
      dative: wording.dative,
    })
  }
  return t('communicationTimeline.estimateEmail.default', { nominative: wording.nominative })
}

function describeApprovalEntry(
  entry: WorkshopOrderCommunication,
  wording: EstimateWording,
  t: TFunction<'workshop'>,
): string {
  const approved = entry.decision === 'APPROVED'
  const channel = channelSuffix(entry.channel, t)
  if (entry.channel === null || entry.channel === 'LINK') {
    return approved
      ? t('communicationTimeline.approval.linkApproved', { accusative: wording.accusative })
      : t('communicationTimeline.approval.linkDeclined', { accusative: wording.accusative })
  }
  return approved
    ? t('communicationTimeline.approval.advisorApproved', {
        genitive: wording.genitive,
        channel,
      })
    : t('communicationTimeline.approval.advisorDeclined', {
        genitive: wording.genitive,
        channel,
      })
}

function describeOverrunNotice(
  entry: WorkshopOrderCommunication,
  wording: EstimateWording,
  t: TFunction<'workshop'>,
): string {
  return t('communicationTimeline.overrunNotice', {
    dative: wording.dative,
    channel: channelSuffix(entry.channel, t),
  })
}

/** One line per timeline entry, in the advisor's voice. */
export function describeCommunication(entry: WorkshopOrderCommunication): string {
  const t = i18n.getFixedT(i18n.language, 'workshop')
  const wording = estimateWording(entry.version, t)
  switch (entry.kind) {
    case 'READY_EMAIL':
      return describeReadyEmail(entry, t)
    case 'ESTIMATE_EMAIL':
      return describeEstimateEmail(entry, wording, t)
    case 'ESTIMATE_APPROVAL':
      return describeApprovalEntry(entry, wording, t)
    case 'OVERRUN_DETECTED':
      return t('communicationTimeline.overrunDetected', { dative: wording.dative })
    case 'OVERRUN_NOTIFICATION':
      return describeOverrunNotice(entry, wording, t)
  }
}

function TimelineIcon({ entry }: { entry: WorkshopOrderCommunication }) {
  if (entry.kind === 'ESTIMATE_EMAIL' || entry.kind === 'READY_EMAIL') {
    return <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  }
  if (entry.kind === 'OVERRUN_DETECTED' || entry.kind === 'OVERRUN_NOTIFICATION') {
    return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
  }
  return entry.decision === 'APPROVED' ? (
    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
  ) : (
    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
  )
}

/** What the customer side of the order has seen and decided: estimate emails, decisions and overrun entries, newest first. */
export function WorkshopCommunicationTimeline({ orderId }: { orderId: string }) {
  const { t } = useTranslation('workshop')
  const query = useWorkshopOrderCommunications(orderId)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">{t('communicationTimeline.title')}</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            {t('communicationTimeline.loading')}
          </p>
        ) : query.isError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle as="h3">{t('communicationTimeline.loadErrorTitle')}</AlertTitle>
            <AlertDescription>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => void query.refetch()}>
                {t('communicationTimeline.retry')}
              </Button>
            </AlertDescription>
          </Alert>
        ) : query.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">{t('communicationTimeline.empty')}</p>
        ) : (
          <ol className="space-y-3">
            {query.data.map((entry) => (
              <li key={`${entry.kind}-${entry.id}`} className="flex gap-3">
                <TimelineIcon entry={entry} />
                <div className="min-w-0">
                  <p className="text-sm">{describeCommunication(entry)}</p>
                  <time className="text-xs text-muted-foreground" dateTime={entry.occurred_at}>
                    {formatDateTime(entry.occurred_at)}
                  </time>
                </div>
              </li>
            ))}
          </ol>
        )}
      </CardContent>
    </Card>
  )
}
