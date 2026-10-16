import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime } from '@/lib/format'
import {
  useCustomerCommunicationHistory,
  useCustomerCommunicationPreferences,
  useRecordCommunicationEvent,
} from '@/api/customer-consent'

type CustomerConsentPanelProps = {
  customerId: string
  contactEmail?: string | null
}

export function CustomerConsentPanel({
  customerId,
  contactEmail,
}: CustomerConsentPanelProps) {
  const { t } = useTranslation('customers')
  const { data: preferences, isLoading: prefsLoading } =
    useCustomerCommunicationPreferences(customerId)
  const { data: history, isLoading: historyLoading } =
    useCustomerCommunicationHistory(customerId)
  const recordEvent = useRecordCommunicationEvent(customerId)

  const submitMarketing = async (status: 'GRANTED' | 'REVOKED' | 'SOFT_OPT_IN') => {
    if (!preferences) {
      return
    }
    try {
      await recordEvent.mutateAsync({
        expected_revision: preferences.revision,
        idempotency_key: `${status}-${Date.now()}`,
        channel: 'EMAIL',
        purpose: 'MARKETING',
        status,
        basis: status === 'GRANTED' ? 'CONSENT' : undefined,
        source: 'PROFILE',
        contact_address: contactEmail ?? undefined,
        text_version: status === 'GRANTED' ? 'mkt-v1' : undefined,
        text_snapshot:
          status === 'GRANTED'
            ? 'Pilot customer optional marketing consent (UI snapshot).'
            : undefined,
      })
      toast.success(t('consent.saved'))
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('consent.failed'))
    }
  }

  if (prefsLoading) {
    return <div className='text-sm text-muted-foreground'>…</div>
  }

  const marketingRows =
    preferences?.preferences.filter((row) => row.purpose === 'MARKETING') ?? []

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>{t('consent.title')}</CardTitle>
          <p className='text-sm text-muted-foreground'>{t('consent.description')}</p>
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex flex-wrap gap-2 justify-end'>
            <Button
              type='button'
              variant='outline'
              disabled={recordEvent.isPending}
              onClick={() => submitMarketing('GRANTED')}
            >
              {t('consent.recordGrant')}
            </Button>
            <Button
              type='button'
              variant='outline'
              disabled={recordEvent.isPending}
              onClick={() => submitMarketing('SOFT_OPT_IN')}
            >
              {t('consent.softOptIn')}
            </Button>
            <Button
              type='button'
              variant='secondary'
              disabled={recordEvent.isPending}
              onClick={() => submitMarketing('REVOKED')}
            >
              {t('consent.recordRevoke')}
            </Button>
          </div>
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>{t('consent.channel')}</TableHead>
                <TableHead>{t('consent.purpose')}</TableHead>
                <TableHead>{t('consent.status')}</TableHead>
                <TableHead>{t('consent.allowed')}</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {marketingRows.map((row) => (
                <TableRow key={`${row.channel}-${row.purpose}`}>
                  <TableCell>{row.channel}</TableCell>
                  <TableCell>{row.purpose}</TableCell>
                  <TableCell>{row.effective_status ?? '—'}</TableCell>
                  <TableCell>{row.allowed ? t('consent.yes') : t('consent.no')}</TableCell>
                </TableRow>
              ))}
            </TableBody>
          </Table>
          {preferences ? (
            <p className='text-xs text-muted-foreground'>
              {t('consent.revision')}: {preferences.revision}
            </p>
          ) : null}
        </CardContent>
      </Card>

      <Card>
        <CardHeader>
          <CardTitle>{t('consent.historyTitle')}</CardTitle>
        </CardHeader>
        <CardContent>
          {historyLoading ? (
            <div className='text-sm text-muted-foreground'>…</div>
          ) : history && history.length > 0 ? (
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>{t('consent.channel')}</TableHead>
                  <TableHead>{t('consent.purpose')}</TableHead>
                  <TableHead>{t('consent.status')}</TableHead>
                  <TableHead>Recorded</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {history.map((event) => (
                  <TableRow key={event.id}>
                    <TableCell>{event.channel}</TableCell>
                    <TableCell>{event.purpose}</TableCell>
                    <TableCell>{event.status}</TableCell>
                    <TableCell>{formatDateTime(event.recorded_at)}</TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          ) : (
            <p className='text-sm text-muted-foreground'>{t('consent.emptyHistory')}</p>
          )}
        </CardContent>
      </Card>
    </div>
  )
}
