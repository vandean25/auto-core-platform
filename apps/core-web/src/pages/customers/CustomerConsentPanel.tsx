import { useEffect, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { useCustomerCommunicationHistory, useCustomerCommunicationPreferences } from '@/api/customer-consent'
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from '@/components/ui/table'
import { useCustomerConsentActions } from './useCustomerConsentActions'
import { CardSkeleton } from '@/components/ui/skeleton-presets'
import {
  ConsentGrantDialog,
  ConsentHistoryCard,
  ConsentRevokeDialog,
  MARKETING_PURPOSES,
} from './customer-consent-parts'

type CustomerConsentPanelProps = {
  customerId: string
  contactEmail?: string | null
}

export function CustomerConsentPanel({
  customerId,
  contactEmail,
}: CustomerConsentPanelProps) {
  const { t } = useTranslation('customers')
  const { t: tCommon } = useTranslation('common')
  const [namespaceReady, setNamespaceReady] = useState(false)
  useEffect(() => {
    void ensureNamespaceLoaded('customers').then(() => setNamespaceReady(true))
  }, [])

  const { data: preferences, isLoading: prefsLoading } =
    useCustomerCommunicationPreferences(customerId)
  const { data: history, isLoading: historyLoading } =
    useCustomerCommunicationHistory(customerId)
  const {
    grantOpen,
    setGrantOpen,
    revokeOpen,
    setRevokeOpen,
    purpose,
    setPurpose,
    textVersion,
    setTextVersion,
    textSnapshot,
    setTextSnapshot,
    isPending,
    submitGrant,
    submitRevoke,
  } = useCustomerConsentActions(customerId, contactEmail, preferences)

  if (!namespaceReady || prefsLoading) {
    return (
      <div role='status' aria-busy='true'>
        <span className='sr-only'>{tCommon('shell.loading')}</span>
        <CardSkeleton lines={2} />
      </div>
    )
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
              disabled={isPending}
              onClick={() => setGrantOpen(true)}
            >
              {t('consent.recordGrant')}
            </Button>
            <Button
              type='button'
              variant='secondary'
              disabled={isPending}
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

      <ConsentHistoryCard history={history} loading={historyLoading} />

      <ConsentGrantDialog
        open={grantOpen}
        onOpenChange={setGrantOpen}
        purpose={purpose}
        onPurposeChange={setPurpose}
        textVersion={textVersion}
        onTextVersionChange={setTextVersion}
        textSnapshot={textSnapshot}
        onTextSnapshotChange={setTextSnapshot}
        pending={isPending}
        onConfirm={() => void submitGrant()}
      />

      <ConsentRevokeDialog
        open={revokeOpen}
        onOpenChange={setRevokeOpen}
        purpose={purpose}
        onPurposeChange={setPurpose}
        pending={isPending}
        onConfirm={() => void submitRevoke()}
      />
    </div>
  )
}
