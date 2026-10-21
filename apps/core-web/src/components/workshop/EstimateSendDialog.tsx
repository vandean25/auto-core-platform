import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Label } from '@/components/ui/label'
import { useCustomer, useUpdateCustomer } from '@/api/customers'
import type { components } from '@/api/generated/openapi'
import type { WorkshopEstimateVersionSummary } from '@/api/workshop-estimates'
import type { Customer } from '@/api/types'
import { getErrorBody } from '@/lib/error-utils'
import { i18n } from '@/lib/i18n'

export type EstimateSendCustomer = components['schemas']['WorkshopCustomerSummaryDto']

export function describeSendError(error: unknown): string {
  const body = getErrorBody(error)
  const code = body?.code
  if (code) {
    const key = `estimateSend.errors.${code}`
    if (i18n.exists(key, { ns: 'workshop' })) {
      return String(i18n.t(key as never, { ns: 'workshop' }))
    }
  }
  return i18n.t('estimateSend.genericError', { ns: 'workshop' })
}

interface EstimateSendDialogProps {
  version: WorkshopEstimateVersionSummary | null
  customer: EstimateSendCustomer | null
  isSending: boolean
  /** Sends the version. Rejects with the API error, which the dialog shows. */
  onSend: (version: WorkshopEstimateVersionSummary, notifyCustomerByEmail: boolean) => Promise<void>
  onClose: () => void
}

interface BodyProps extends Omit<EstimateSendDialogProps, 'version'> {
  version: WorkshopEstimateVersionSummary
}

function EstimateSendDialogBody({ version, customer, isSending, onSend, onClose }: BodyProps) {
  const { t } = useTranslation('workshop')
  const customerQuery = useCustomer<Customer>(customer?.id ?? '')
  const updateCustomer = useUpdateCustomer()
  const [notifyOverride, setNotifyOverride] = useState<boolean | null>(null)
  const [emailConfirmed, setEmailConfirmed] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [working, setWorking] = useState(false)

  const email = (customerQuery.data?.email ?? customer?.email ?? '').trim()
  const hasEmail = email.length > 0
  const notify = hasEmail && (notifyOverride ?? true)
  const contactConfirmedOnServer = customerQuery.data?.contact_email_ok === true
  const needsConfirmation = notify && !contactConfirmedOnServer
  const busy = working || isSending
  const canSend = !busy && !(notify && customerQuery.isLoading) && !(needsConfirmation && !emailConfirmed)

  const handleSend = async () => {
    setError(null)
    setWorking(true)
    try {
      if (notify && needsConfirmation && customer) {
        await updateCustomer.mutateAsync({ id: customer.id, data: { contact_email_ok: true } })
      }
      await onSend(version, notify)
    } catch (sendError: unknown) {
      setError(describeSendError(sendError))
    } finally {
      setWorking(false)
    }
  }

  return (
    <DialogContent>
      <DialogHeader>
        <DialogTitle>{t('estimateSend.title', { version: version.version })}</DialogTitle>
        <DialogDescription>{t('estimateSend.description')}</DialogDescription>
      </DialogHeader>

      <div className='space-y-4 text-sm'>
        <dl className='space-y-1'>
          <div className='flex gap-2'>
            <dt className='text-slate-500'>{t('estimateSend.recipient')}</dt>
            <dd className='min-w-0 break-words font-medium'>{hasEmail ? email : '—'}</dd>
          </div>
          <div className='flex gap-2'>
            <dt className='text-slate-500'>{t('estimateSend.validity')}</dt>
            <dd className='font-medium'>{t('estimateSend.validityValue')}</dd>
          </div>
        </dl>

        <div className='flex items-start gap-2'>
          <Checkbox
            id='estimate-send-notify'
            checked={notify}
            disabled={!hasEmail || busy}
            onCheckedChange={(checked) => setNotifyOverride(checked === true)}
          />
          <Label htmlFor='estimate-send-notify' className='leading-snug'>
            {t('estimateSend.notifyEmail')}
          </Label>
        </div>

        {!hasEmail && <p className='text-slate-600'>{t('estimateSend.emailMissing')}</p>}
        {!notify && <p className='text-slate-600'>{t('estimateSend.recordOnly')}</p>}

        {needsConfirmation && (
          <div className='flex items-start gap-2'>
            <Checkbox
              id='estimate-send-email-confirmed'
              checked={emailConfirmed}
              disabled={busy}
              onCheckedChange={(checked) => setEmailConfirmed(checked === true)}
            />
            <Label htmlFor='estimate-send-email-confirmed' className='font-normal leading-snug'>
              {t('estimateSend.emailConfirmed')}
            </Label>
          </div>
        )}

        {error && (
          <Alert variant='destructive'>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        )}
      </div>

      <DialogFooter>
        <Button variant='outline' onClick={onClose} disabled={busy}>
          {t('estimateSend.cancel')}
        </Button>
        <Button onClick={() => void handleSend()} disabled={!canSend}>
          {busy ? t('estimateSend.sending') : t('estimateSend.send')}
        </Button>
      </DialogFooter>
    </DialogContent>
  )
}

/**
 * Send dialog for a DRAFT Kostenvoranschlag. The body mounts per open version, so its state starts fresh each time.
 * The customer's contact confirmation is read from the customer record, which the order summary does not carry.
 */
export function EstimateSendDialog({ version, ...rest }: EstimateSendDialogProps) {
  return (
    <Dialog
      open={version !== null}
      onOpenChange={(open) => {
        if (!open) rest.onClose()
      }}
    >
      {version && <EstimateSendDialogBody key={version.id} version={version} {...rest} />}
    </Dialog>
  )
}
