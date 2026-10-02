import { useEffect } from 'react'
import { useParams } from 'react-router-dom'
import { format } from 'date-fns'
import { useLoanerBooking, getLoanerBookingCustomerLabel } from '@/api/loaner-vehicles'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'

export default function LoanerBookingPrintPage() {
  const { id = '' } = useParams<{ id: string }>()
  const { data: booking, isLoading, isError } = useLoanerBooking(id)

  useEffect(() => {
    document.title = booking ? `Ersatzwagen Protokoll ${booking.id}` : 'Ersatzwagen Protokoll'
  }, [booking])

  if (isLoading) {
    return <p className='p-8 text-muted-foreground'>Protokoll wird geladen…</p>
  }

  if (isError || !booking) {
    return <p className='p-8 text-destructive'>Buchung nicht gefunden.</p>
  }

  const damageOut = (booking as { damageNotesOut?: string | null }).damageNotesOut
  const damageIn = (booking as { damageNotesIn?: string | null }).damageNotesIn

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
            Zurück
          </Button>
          <Button onClick={() => window.print()}>Drucken</Button>
        </div>

        <header className='space-y-2 border-b border-slate-300 pb-4'>
          <h1 className='text-2xl font-semibold'>Ersatzfahrzeug Protokoll</h1>
          <p className='text-sm text-muted-foreground'>Buchung {booking.id}</p>
          <div className='flex flex-wrap items-center gap-2'>
            <StatusBadge status={booking.status} />
            <span className='text-sm'>
              {format(new Date(booking.plannedFrom), 'PPp')} –{' '}
              {format(new Date(booking.plannedTo), 'PPp')}
            </span>
          </div>
        </header>

        <section className='space-y-2'>
          <h2 className='text-lg font-medium'>Kunde</h2>
          <p>{getLoanerBookingCustomerLabel(booking)}</p>
          {booking.workshopOrderId ? (
            <p className='text-sm text-muted-foreground'>Werkstattauftrag: {booking.workshopOrderId}</p>
          ) : null}
        </section>

        <section className='grid gap-6 sm:grid-cols-2'>
          <div className='space-y-3 rounded-lg border border-slate-200 p-4'>
            <h2 className='text-lg font-medium'>Übergabe</h2>
            <dl className='space-y-2 text-sm'>
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>Zeitpunkt</dt>
                <dd>
                  {booking.handedOverAt
                    ? format(new Date(booking.handedOverAt), 'PPp')
                    : '—'}
                </dd>
              </div>
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>Kilometerstand</dt>
                <dd>{booking.odometerOut ?? '—'}</dd>
              </div>
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>Tank (%)</dt>
                <dd>{booking.fuelOut ?? '—'}</dd>
              </div>
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>Führerschein geprüft</dt>
                <dd>{booking.driverLicenceChecked ? 'Ja' : 'Nein'}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>Schäden / Notizen</dt>
                <dd className='mt-1 whitespace-pre-wrap'>{damageOut || '—'}</dd>
              </div>
            </dl>
          </div>

          <div className='space-y-3 rounded-lg border border-slate-200 p-4'>
            <h2 className='text-lg font-medium'>Rückgabe</h2>
            <dl className='space-y-2 text-sm'>
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>Zeitpunkt</dt>
                <dd>
                  {booking.returnedAt ? format(new Date(booking.returnedAt), 'PPp') : '—'}
                </dd>
              </div>
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>Kilometerstand</dt>
                <dd>{booking.odometerIn ?? '—'}</dd>
              </div>
              <div className='flex justify-between gap-4'>
                <dt className='text-muted-foreground'>Tank (%)</dt>
                <dd>{booking.fuelIn ?? '—'}</dd>
              </div>
              <div>
                <dt className='text-muted-foreground'>Schäden / Notizen</dt>
                <dd className='mt-1 whitespace-pre-wrap'>{damageIn || '—'}</dd>
              </div>
            </dl>
          </div>
        </section>

        {booking.notes ? (
          <section className='space-y-2'>
            <h2 className='text-lg font-medium'>Buchungsnotizen</h2>
            <p className='whitespace-pre-wrap text-sm'>{booking.notes}</p>
          </section>
        ) : null}
      </div>
    </>
  )
}
