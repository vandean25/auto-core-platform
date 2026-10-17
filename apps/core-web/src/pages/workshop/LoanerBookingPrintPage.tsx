import { useParams } from 'react-router-dom'
import { formatDateTime } from '@/lib/format'
import { useTranslation } from 'react-i18next'
import { useLoanerBooking, getLoanerBookingCustomerLabel } from '@/api/loaner-vehicles'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import { useDocumentTitle } from '@/hooks/useDocumentTitle'

export default function LoanerBookingPrintPage() {
  const { t } = useTranslation('workshop')
  const { id = '' } = useParams<{ id: string }>()
  const { data: booking, isLoading, isError } = useLoanerBooking(id)

  useDocumentTitle(booking?.id)

  if (isLoading) {
    return <p className='p-8 text-muted-foreground'>{t('loanerPrint.loading')}</p>
  }

  if (isError || !booking) {
    return <p className='p-8 text-destructive'>{t('loanerPrint.notFound')}</p>
  }

  const loanerLabel = booking.loanerVehicle?.displayName ?? booking.loanerVehicleId
  const emDash = t('loanerPrint.emDash')

  return (
    <>
      <style>{`
        @media print {
          .loaner-print-actions { display: none !important; }
          body { background: white; }
        }
      `}</style>
      <div className='mx-auto max-w-3xl space-y-8 p-8 print:p-0'>
        <div className='loaner-print-actions flex justify-end gap-2'>
          <Button variant='outline' onClick={() => window.history.back()}>
            {t('loanerPrint.back')}
          </Button>
          <Button onClick={() => window.print()}>{t('loanerPrint.print')}</Button>
        </div>

        <header className='space-y-2 border-b border-slate-300 pb-4'>
          <h1 className='text-2xl font-semibold'>{t('loanerPrint.title')}</h1>
          <p className='text-sm text-muted-foreground'>
            {t('loanerPrint.bookingMeta', { id: booking.id })}
          </p>
          <div className='flex flex-wrap items-center gap-2'>
            <StatusBadge status={booking.status} />
            <span className='text-sm'>
              {formatDateTime(booking.plannedFrom)} – {formatDateTime(booking.plannedTo)}
            </span>
          </div>
        </header>

        <section className='space-y-2'>
          <h2 className='text-lg font-medium'>{t('loanerPrint.loanerSection')}</h2>
          <p className='font-medium'>{loanerLabel}</p>
        </section>

        <section className='space-y-2'>
          <h2 className='text-lg font-medium'>{t('loanerPrint.customerSection')}</h2>
          <p>{getLoanerBookingCustomerLabel(booking)}</p>
          {booking.workshopOrderId ? (
            <p className='text-sm text-muted-foreground'>
              {t('loanerPrint.workshopOrder', { id: booking.workshopOrderId })}
            </p>
          ) : null}
        </section>

        <section className='grid gap-6 sm:grid-cols-2'>
          <div className='space-y-3 rounded-lg border border-slate-200 p-4'>
            <h2 className='text-lg font-medium'>{t('loanerPrint.handover')}</h2>
            <dl className='space-y-2 text-sm'>
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>{t('loanerPrint.time')}</dt>
                <dd>
                  {booking.handedOverAt
                    ? formatDateTime(booking.handedOverAt)
                    : emDash}
                </dd>
              </div>
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>{t('loanerPrint.odometer')}</dt>
                <dd>{booking.odometerOut ?? emDash}</dd>
              </div>
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>{t('loanerPrint.fuel')}</dt>
                <dd>{booking.fuelOut ?? emDash}</dd>
              </div>
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>{t('loanerPrint.licenceChecked')}</dt>
                <dd>{booking.driverLicenceChecked ? t('loanerPrint.yes') : t('loanerPrint.no')}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>{t('loanerPrint.damageNotes')}</dt>
                <dd className='mt-1 whitespace-pre-wrap'>{booking.damageNotesOut || emDash}</dd>
              </div>
            </dl>
            <div className='mt-8 border-t border-dashed border-slate-300 pt-4'>
              <p className='text-sm text-muted-foreground'>{t('loanerPrint.signatureHandover')}</p>
              <div className='mt-10 h-10 border-b border-slate-400' />
            </div>
          </div>

          <div className='space-y-3 rounded-lg border border-slate-200 p-4'>
            <h2 className='text-lg font-medium'>{t('loanerPrint.return')}</h2>
            <dl className='space-y-2 text-sm'>
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>{t('loanerPrint.time')}</dt>
                <dd>
                  {booking.returnedAt ? formatDateTime(booking.returnedAt) : emDash}
                </dd>
              </div>
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>{t('loanerPrint.odometer')}</dt>
                <dd>{booking.odometerIn ?? emDash}</dd>
              </div>
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>{t('loanerPrint.fuel')}</dt>
                <dd>{booking.fuelIn ?? emDash}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>{t('loanerPrint.damageNotes')}</dt>
                <dd className='mt-1 whitespace-pre-wrap'>{booking.damageNotesIn || emDash}</dd>
              </div>
            </dl>
            <div className='mt-8 border-t border-dashed border-slate-300 pt-4'>
              <p className='text-sm text-muted-foreground'>{t('loanerPrint.signatureReturn')}</p>
              <div className='mt-10 h-10 border-b border-slate-400' />
            </div>
          </div>
        </section>

        {booking.notes ? (
          <section className='space-y-2'>
            <h2 className='text-lg font-medium'>{t('loanerPrint.bookingNotes')}</h2>
            <p className='whitespace-pre-wrap text-sm'>{booking.notes}</p>
          </section>
        ) : null}
      </div>
    </>
  )
}
