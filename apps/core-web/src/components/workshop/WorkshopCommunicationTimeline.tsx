import { AlertTriangle, CheckCircle2, Loader2, Mail, XCircle } from 'lucide-react'
import { useWorkshopOrderCommunications } from '@/api/workshop-communications'
import type { WorkshopOrderCommunication } from '@/api/workshop-communications'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { formatDateTime } from '@/lib/format'

/** The channels an advisor records a decision or an overrun notice by. Other channels get no suffix. */
const ADVISOR_CHANNEL_LABELS: Partial<Record<string, string>> = {
  PHONE: 'Telefon',
  IN_PERSON: 'persönlich',
  EMAIL: 'E-Mail',
}

/** " (Telefon)" for a channel that has a label, and nothing for the customer link or the legacy advisor record. */
function channelSuffix(channel: string | null): string {
  const label = channel ? ADVISOR_CHANNEL_LABELS[channel] : undefined
  return label ? ` (${label})` : ''
}

/** The estimate's name in the four cases the German lines need. The version is named when the entry knows it. */
interface EstimateWording {
  nominative: string
  accusative: string
  dative: string
  genitive: string
}

/** The noun takes the article its case needs, so the lines read as German. */
function estimateWording(version: number | null): EstimateWording {
  const suffix = version === null ? '' : ` (Version ${version})`
  return {
    nominative: `Der Kostenvoranschlag${suffix}`,
    accusative: `den Kostenvoranschlag${suffix}`,
    dative: `dem Kostenvoranschlag${suffix}`,
    genitive: `des Kostenvoranschlags${suffix}`,
  }
}

function describeReadyEmail(entry: WorkshopOrderCommunication): string {
  switch (entry.status) {
    case 'QUEUED':
      return 'Die Abholbenachrichtigung wird per E-Mail versendet'
    case 'SENT':
      return 'Die Abholbenachrichtigung wurde per E-Mail gesendet'
    case 'FAILED':
      return 'Die Abholbenachrichtigung konnte nicht per E-Mail gesendet werden'
    case 'SUPPRESSED':
      return 'Die Abholbenachrichtigung wurde nicht per E-Mail gesendet'
    default:
      return 'Abholbenachrichtigung per E-Mail'
  }
}

function describeEstimateEmail(entry: WorkshopOrderCommunication, wording: EstimateWording): string {
  switch (entry.status) {
    case 'QUEUED':
      return `${wording.nominative} wird per E-Mail versendet`
    case 'SENT':
      return `${wording.nominative} wurde per E-Mail gesendet`
    case 'FAILED':
      return `Die E-Mail mit ${wording.dative} konnte nicht gesendet werden`
    case 'SUPPRESSED':
      return `Die E-Mail mit ${wording.dative} wurde nicht gesendet`
    default:
      return `${wording.nominative} per E-Mail`
  }
}

/** A customer decision: through the link, or recorded by the advisor by phone, in person or by email. */
function describeApprovalEntry(entry: WorkshopOrderCommunication, wording: EstimateWording): string {
  const approved = entry.decision === 'APPROVED'
  if (entry.channel === null || entry.channel === 'LINK') {
    return approved
      ? `Der Kunde hat ${wording.accusative} über den Link freigegeben`
      : `Der Kunde hat ${wording.accusative} über den Link abgelehnt`
  }
  const subject = approved ? `Die Freigabe ${wording.genitive}` : `Die Ablehnung ${wording.genitive}`
  return `${subject} wurde vom Berater erfasst${channelSuffix(entry.channel)}`
}

function describeOverrunNotice(entry: WorkshopOrderCommunication, wording: EstimateWording): string {
  return `Der Kunde wurde über den Mehrbedarf gegenüber ${wording.dative} informiert${channelSuffix(entry.channel)}`
}

/** One German line per timeline entry, in the advisor's voice. */
export function describeCommunication(entry: WorkshopOrderCommunication): string {
  const wording = estimateWording(entry.version)
  switch (entry.kind) {
    case 'READY_EMAIL':
      return describeReadyEmail(entry)
    case 'ESTIMATE_EMAIL':
      return describeEstimateEmail(entry, wording)
    case 'ESTIMATE_APPROVAL':
      return describeApprovalEntry(entry, wording)
    case 'OVERRUN_DETECTED':
      return `Mehrbedarf gegenüber ${wording.dative} festgestellt`
    case 'OVERRUN_NOTIFICATION':
      return describeOverrunNotice(entry, wording)
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
  const query = useWorkshopOrderCommunications(orderId)

  return (
    <Card>
      <CardHeader>
        <CardTitle className="text-base font-semibold">Kommunikation mit dem Kunden</CardTitle>
      </CardHeader>
      <CardContent>
        {query.isPending ? (
          <p className="flex items-center gap-2 text-sm text-muted-foreground">
            <Loader2 className="h-4 w-4 animate-spin" aria-hidden="true" />
            Kommunikation wird geladen …
          </p>
        ) : query.isError ? (
          <Alert variant="destructive">
            <AlertTriangle className="h-4 w-4" />
            <AlertTitle as="h3">Kommunikation konnte nicht geladen werden.</AlertTitle>
            <AlertDescription>
              <Button variant="outline" size="sm" className="mt-2" onClick={() => void query.refetch()}>
                Erneut versuchen
              </Button>
            </AlertDescription>
          </Alert>
        ) : query.data.length === 0 ? (
          <p className="text-sm text-muted-foreground">Noch keine Kommunikation mit dem Kunden.</p>
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
