import { useTranslation } from 'react-i18next'
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
import { Skeleton } from '@/components/ui/skeleton'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { formatDateTime } from '@/lib/format'
import type { useCustomerCommunicationHistory } from '@/api/customer-consent'

export const MARKETING_PURPOSES = new Set([
  'PICKERL_REMINDER',
  'SERVICE_REMINDER',
  'REVIEW_REQUEST',
  'SEASONAL_OFFERS',
  'NEWSLETTER',
])

type HistoryEvents = ReturnType<typeof useCustomerCommunicationHistory>['data']

function PurposeSelect({ id, value, onChange }: { id: string; value: string; onChange: (value: string) => void }) {
  return (
    <select
      id={id}
      className='flex h-9 w-full rounded-md border border-input bg-background px-3 text-base md:text-sm'
      value={value}
      onChange={(event) => onChange(event.target.value)}
    >
      {Array.from(MARKETING_PURPOSES).map((purpose) => (
        <option key={purpose} value={purpose}>
          {purpose}
        </option>
      ))}
    </select>
  )
}

function HistoryBody({ history, loading }: { history: HistoryEvents; loading: boolean }) {
  const { t } = useTranslation('customers')
  const { t: tCommon } = useTranslation('common')

  if (loading) {
    return (
      <div role='status' aria-busy='true'>
        <span className='sr-only'>{tCommon('shell.loading')}</span>
        <Skeleton className='h-4 w-full max-w-40' />
      </div>
    )
  }
  if (!history || history.length === 0) {
    return <p className='text-sm text-muted-foreground'>{t('consent.emptyHistory')}</p>
  }

  return (
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
  )
}

export function ConsentHistoryCard({ history, loading }: { history: HistoryEvents; loading: boolean }) {
  const { t } = useTranslation('customers')

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t('consent.historyTitle')}</CardTitle>
      </CardHeader>
      <CardContent>
        <HistoryBody history={history} loading={loading} />
      </CardContent>
    </Card>
  )
}

type GrantDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  purpose: string
  onPurposeChange: (value: string) => void
  textVersion: string
  onTextVersionChange: (value: string) => void
  textSnapshot: string
  onTextSnapshotChange: (value: string) => void
  pending: boolean
  onConfirm: () => void
}

export function ConsentGrantDialog(props: GrantDialogProps) {
  const { t } = useTranslation('customers')

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('consent.grantDialogTitle')}</DialogTitle>
        </DialogHeader>
        <div className='space-y-3'>
          <div>
            <Label htmlFor='consent-purpose'>{t('consent.purpose')}</Label>
            <PurposeSelect id='consent-purpose' value={props.purpose} onChange={props.onPurposeChange} />
          </div>
          <div>
            <Label htmlFor='consent-text-version'>{t('consent.textVersion')}</Label>
            <Input
              id='consent-text-version'
              value={props.textVersion}
              onChange={(event) => props.onTextVersionChange(event.target.value)}
            />
          </div>
          <div>
            <Label htmlFor='consent-text'>{t('consent.textShown')}</Label>
            <textarea
              id='consent-text'
              className='flex min-h-24 w-full rounded-md border border-input bg-background px-3 py-2 text-base md:text-sm'
              value={props.textSnapshot}
              onChange={(event) => props.onTextSnapshotChange(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('consent.cancel')}
          </Button>
          <Button type='button' disabled={props.pending} onClick={props.onConfirm}>
            {t('consent.confirmGrant')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}

type RevokeDialogProps = Pick<GrantDialogProps, 'open' | 'onOpenChange' | 'purpose' | 'onPurposeChange' | 'pending' | 'onConfirm'>

export function ConsentRevokeDialog(props: RevokeDialogProps) {
  const { t } = useTranslation('customers')

  return (
    <Dialog open={props.open} onOpenChange={props.onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t('consent.revokeDialogTitle')}</DialogTitle>
        </DialogHeader>
        <div>
          <Label htmlFor='revoke-purpose'>{t('consent.purpose')}</Label>
          <PurposeSelect id='revoke-purpose' value={props.purpose} onChange={props.onPurposeChange} />
        </div>
        <DialogFooter>
          <Button type='button' variant='outline' onClick={() => props.onOpenChange(false)}>
            {t('consent.cancel')}
          </Button>
          <Button type='button' disabled={props.pending} onClick={props.onConfirm}>
            {t('consent.confirmRevoke')}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
