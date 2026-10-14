import { AlertTriangle, CheckCircle2, Loader2, Mail, XCircle } from 'lucide-react'
import { useWorkshopOrderCommunications } from '@/api/workshop-communications'
import type { WorkshopOrderCommunication } from '@/api/workshop-communications'
import { Alert, AlertDescription, AlertTitle } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'

const dateTimeFormat = new Intl.DateTimeFormat('de-AT', {
  day: '2-digit',
  month: '2-digit',
  year: 'numeric',
  hour: '2-digit',
  minute: '2-digit',
  timeZone: 'Europe/Vienna',
})

/** One German line per timeline entry. The estimate version is named when the entry knows it. */
const CHANNEL_LABELS: Record<string, string> = {
  PHONE: 'Telefon',
  IN_PERSON: 'persönlich',
  EMAIL: 'E-Mail',
}

function channelLabel(channel: string): string {
  return CHANNEL_LABELS[channel] ?? channel
}

export function describeCommunication(entry: WorkshopOrderCommunication): string {
  // The noun takes the article its case needs, so the lines read as German.
  const suffix = entry.version === null ? '' : ` (Version ${entry.version})`
  const nominative = `Der Kostenvoranschlag${suffix}`
  const accusative = `den Kostenvoranschlag${suffix}`
  const dative = `dem Kostenvoranschlag${suffix}`
  const genitive = `des Kostenvoranschlags${suffix}`

  if (entry.kind === 'ESTIMATE_EMAIL') {
    switch (entry.status) {
      case 'QUEUED':
        return `${nominative} wird per E-Mail versendet`
      case 'SENT':
        return `${nominative} wurde per E-Mail gesendet`
      case 'FAILED':
        return `Die E-Mail mit ${dative} konnte nicht gesendet werden`
      case 'SUPPRESSED':
        return `Die E-Mail mit ${dative} wurde nicht gesendet`
      default:
        return `${nominative} per E-Mail`
    }
  }

  if (entry.kind === 'OVERRUN_NOTIFICATION') {
    return `Der Kunde wurde über den Mehrbedarf gegenüber ${dative} informiert (${channelLabel(entry.channel)})`
  }

  if (entry.channel === 'PHONE' || entry.channel === 'IN_PERSON' || entry.channel === 'EMAIL') {
    return entry.decision === 'APPROVED'
      ? `Die Freigabe ${genitive} wurde vom Berater erfasst (${channelLabel(entry.channel)})`
      : `Die Ablehnung ${genitive} wurde vom Berater erfasst (${channelLabel(entry.channel)})`
  }

  if (entry.channel === 'ADVISOR_RECORDED') {
    return entry.decision === 'APPROVED'
      ? `Die Freigabe ${genitive} wurde vom Berater erfasst`
      : `Die Ablehnung ${genitive} wurde vom Berater erfasst`
  }
  return entry.decision === 'APPROVED'
    ? `Der Kunde hat ${accusative} über den Link freigegeben`
    : `Der Kunde hat ${accusative} über den Link abgelehnt`
}

function TimelineIcon({ entry }: { entry: WorkshopOrderCommunication }) {
  if (entry.kind === 'ESTIMATE_EMAIL') {
    return <Mail className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" aria-hidden="true" />
  }
  if (entry.kind === 'OVERRUN_NOTIFICATION') {
    return <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-600" aria-hidden="true" />
  }
  return entry.decision === 'APPROVED' ? (
    <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-600" aria-hidden="true" />
  ) : (
    <XCircle className="mt-0.5 h-4 w-4 shrink-0 text-destructive" aria-hidden="true" />
  )
}

/** What the customer side of the order has seen and decided: estimate emails and approvals, newest first. */
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
                    {dateTimeFormat.format(new Date(entry.occurred_at))}
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
