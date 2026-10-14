import { useState } from 'react'
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
import { getErrorBody, getErrorMessage } from '@/lib/error-utils'

export type EstimateSendCustomer = components['schemas']['WorkshopCustomerSummaryDto']

export const ESTIMATE_EMAIL_MISSING_MESSAGE = 'Für den E-Mail-Versand fehlt die E-Mail-Adresse des Kunden.'

/** Short German copy per send error code. The server's own message wins when it has one. */
const SEND_ERROR_MESSAGES: Record<string, string> = {
  ESTIMATE_CUSTOMER_EMAIL_NOT_CONFIRMED:
    'Die E-Mail-Adresse des Kunden ist noch nicht für die Auftragskommunikation bestätigt.',
  ESTIMATE_CUSTOMER_EMAIL_MISSING: ESTIMATE_EMAIL_MISSING_MESSAGE,
  ESTIMATE_CUSTOMER_EMAIL_INVALID: 'Die E-Mail-Adresse des Kunden ist ungültig.',
  ESTIMATE_VEHICLE_INCOMPLETE: 'Die Fahrzeugdaten sind unvollständig. Bitte ergänzen Sie sie vor dem Versand.',
  ESTIMATE_EMAIL_INCOMPLETE: 'Die Angaben für die E-Mail sind unvollständig. Bitte prüfen Sie Kunde und Fahrzeug.',
  ESTIMATE_APPROVAL_LINK_UNAVAILABLE:
    'Der Freigabe-Link kann derzeit nicht erstellt werden. Bitte versuchen Sie es später erneut.',
  ESTIMATE_SEND_DISABLED: 'Der Versand an Kunden ist derzeit deaktiviert.',
}

export function describeSendError(error: unknown): string {
  const body = getErrorBody(error)
  if (typeof body?.message === 'string' && body.message.trim()) return body.message
  const mapped = body?.code ? SEND_ERROR_MESSAGES[body.code] : undefined
  return mapped ?? getErrorMessage(error, 'Kostenvoranschlag konnte nicht gesendet werden.')
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
        <DialogTitle>{`Version ${version.version} an Kunden senden?`}</DialogTitle>
        <DialogDescription>
          Mit dem Versand wird der Stand des Auftrags als Momentaufnahme festgeschrieben. Spätere Änderungen am Auftrag
          wirken erst nach einer neuen Version.
        </DialogDescription>
      </DialogHeader>

      <div className='space-y-4 text-sm'>
        <dl className='space-y-1'>
          <div className='flex gap-2'>
            <dt className='text-slate-500'>Empfänger:</dt>
            <dd className='min-w-0 break-words font-medium'>{hasEmail ? email : '—'}</dd>
          </div>
          <div className='flex gap-2'>
            <dt className='text-slate-500'>Gültigkeit:</dt>
            <dd className='font-medium'>gültig 14 Tage ab Versand</dd>
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
            Per E-Mail an den Kunden senden
          </Label>
        </div>

        {!hasEmail && <p className='text-slate-600'>{ESTIMATE_EMAIL_MISSING_MESSAGE}</p>}
        {!notify && <p className='text-slate-600'>Der Versand wird nur im Auftrag erfasst. Es wird keine E-Mail gesendet.</p>}

        {needsConfirmation && (
          <div className='flex items-start gap-2'>
            <Checkbox
              id='estimate-send-email-confirmed'
              checked={emailConfirmed}
              disabled={busy}
              onCheckedChange={(checked) => setEmailConfirmed(checked === true)}
            />
            <Label htmlFor='estimate-send-email-confirmed' className='font-normal leading-snug'>
              Der Kunde hat mir diese E-Mail-Adresse für die Auftragskommunikation mitgeteilt.
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
          Abbrechen
        </Button>
        <Button onClick={() => void handleSend()} disabled={!canSend}>
          {busy ? 'Wird gesendet…' : 'Senden'}
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
