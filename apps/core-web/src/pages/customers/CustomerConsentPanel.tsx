import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { formatDateTime } from '@/lib/format'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import {
  useCustomerCommunicationHistory,
  useCustomerCommunicationPreferences,
  useRecordCommunicationEvent,
} from '@/api/customer-consent'

const MARKETING_PURPOSES = new Set([
  'PICKERL_REMINDER',
  'SERVICE_REMINDER',
  'REVIEW_REQUEST',
  'SEASONAL_OFFERS',
  'NEWSLETTER',
])

type CustomerConsentPanelProps = {
  customerId: string
  contactEmail?: string | null
}

export function CustomerConsentPanel({
  customerId,
  contactEmail,
}: CustomerConsentPanelProps) {
  const { t, i18n } = useTranslation('customers')
  const [namespaceReady, setNamespaceReady] = useState(false)
  const [grantOpen, setGrantOpen] = useState(false)
  const [revokeOpen, setRevokeOpen] = useState(false)
  const [purpose, setPurpose] = useState('NEWSLETTER')
  const [textVersion, setTextVersion] = useState('mkt-v1')
  const [textSnapshot, setTextSnapshot] = useState('')

  useEffect(() => {
    void ensureNamespaceLoaded('customers').then(() => setNamespaceReady(true))
  }, [])

  const { data: preferences, isLoading: prefsLoading } =
    useCustomerCommunicationPreferences(customerId)
  const { data: history, isLoading: historyLoading } =
    useCustomerCommunicationHistory(customerId)
  const recordEvent = useRecordCommunicationEvent(customerId)

  const submitGrant = async () => {
    if (!preferences || !textSnapshot.trim()) {
      toast.error(t('consent.textRequired'))
      return
    }
    try {
      await recordEvent.mutateAsync({
        controller_legal_entity_id: preferences.controller_legal_entity_id,
        expected_revision: preferences.revision,
        idempotency_key: `grant-${purpose}-${Date.now()}`,
        channel: 'EMAIL',
        purpose,
        status: 'GRANTED',
        basis: 'CONSENT',
        source: 'PROFILE',
        contact_address: contactEmail ?? undefined,
        text_version: textVersion,
        text_language: i18n.language.slice(0, 2),
        text_snapshot: textSnapshot.trim(),
      })
      toast.success(t('consent.saved'))
      setGrantOpen(false)
      setTextSnapshot('')
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('consent.failed'))
    }
  }

  const submitRevoke = async () => {
    if (!preferences) {
      return
    }
    try {
      await recordEvent.mutateAsync({
        controller_legal_entity_id: preferences.controller_legal_entity_id,
        expected_revision: preferences.revision,
        idempotency_key: `revoke-${purpose}-${Date.now()}`,
        channel: 'EMAIL',
        purpose,
        status: 'REVOKED',
        source: 'PROFILE',
        contact_address: contactEmail ?? undefined,
      })
      toast.success(t('consent.saved'))
      setRevokeOpen(false)
    } catch (error: unknown) {
      toast.error(error instanceof Error ? error.message : t('consent.failed'))
    }
  }

  if (!namespaceReady || prefsLoading) {
    return <div className='text-sm text-muted-foreground'>…</div>
  }

  const marketingRows =
    preferences?.preferences.filter((row) => MARKETING_PURPOSES.has(row.purpose)) ??
    []

  return (
    <div className='space-y-6'>
      <Card>
        <CardHeader>
          <CardTitle>{t('consent.title')}</CardTitle>
          <p className='text-sm text-muted-foreground'>{t('consent.description')}</p>
          {preferences?.controller_legal_entity_name ? (
            <p className='text-sm font-medium'>
              {t('consent.controller')}: {preferences.controller_legal_entity_name}
            </p>
          ) : null}
        </CardHeader>
        <CardContent className='space-y-4'>
          <div className='flex flex-wrap gap-2 justify-end'>
            <Button
              type='button'
              variant='outline'
              disabled={recordEvent.isPending}
              onClick={() => setGrantOpen(true)}
            >
              {t('consent.recordGrant')}
            </Button>
            <Button
              type='button'
              variant='secondary'
              disabled={recordEvent.isPending}
              onClick={() => setRevokeOpen(true)}
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
                  <TableHead>{t('consent.recorded')}</TableHead>
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

      <Dialog open={grantOpen} onOpenChange={setGrantOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('consent.grantDialogTitle')}</DialogTitle>
          </DialogHeader>
          <div className='space-y-3'>
            <div>
              <Label htmlFor='consent-purpose'>{t('consent.purpose')}</Label>
              <select
                id='consent-purpose'
                className='flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
                value={purpose}
                onChange={(event) => setPurpose(event.target.value)}
              >
                {Array.from(MARKETING_PURPOSES).map((value) => (
                  <option key={value} value={value}>
                    {value}
                  </option>
                ))}
              </select>
            </div>
            <div>
              <Label htmlFor='consent-text-version'>{t('consent.textVersion')}</Label>
              <Input
                id='consent-text-version'
                value={textVersion}
                onChange={(event) => setTextVersion(event.target.value)}
              />
            </div>
            <div>
              <Label htmlFor='consent-text'>{t('consent.textShown')}</Label>
              <textarea
                id='consent-text'
                className='flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm'
                value={textSnapshot}
                onChange={(event) => setTextSnapshot(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => setGrantOpen(false)}>
              {t('consent.cancel')}
            </Button>
            <Button type='button' disabled={recordEvent.isPending} onClick={() => void submitGrant()}>
              {t('consent.confirmGrant')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={revokeOpen} onOpenChange={setRevokeOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>{t('consent.revokeDialogTitle')}</DialogTitle>
          </DialogHeader>
          <div>
            <Label htmlFor='revoke-purpose'>{t('consent.purpose')}</Label>
            <select
              id='revoke-purpose'
              className='flex h-9 w-full rounded-md border border-input bg-background px-3 text-sm'
              value={purpose}
              onChange={(event) => setPurpose(event.target.value)}
            >
              {Array.from(MARKETING_PURPOSES).map((value) => (
                <option key={value} value={value}>
                  {value}
                </option>
              ))}
            </select>
          </div>
          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => setRevokeOpen(false)}>
              {t('consent.cancel')}
            </Button>
            <Button type='button' disabled={recordEvent.isPending} onClick={() => void submitRevoke()}>
              {t('consent.confirmRevoke')}
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
