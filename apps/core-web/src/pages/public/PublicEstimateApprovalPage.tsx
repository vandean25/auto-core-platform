import { useEffect, useState } from 'react'
import { Loader2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { ensureNamespaceLoaded, i18n } from '@/lib/i18n'
import { PageLoader } from '@/components/ui/PageLoader'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  PublicEstimateApprovalError,
  fetchPublicEstimate,
  submitPublicEstimateDecision,
} from '@/api/public-estimate-approvals'
import type { PublicEstimateDecisionResult, PublicEstimateView } from '@/api/public-estimate-approvals'
import { formatCurrency, formatDateTime, formatNumber } from '@/lib/format'

const MAX_NAME_LENGTH = 120
const MIN_NAME_LENGTH = 2

function loadErrorFallback() {
  return i18n.t('workshop:publicEstimateApproval.loadFailed')
}

function errorMessageForStatus(status: number): string {
  return i18n.t(`workshop:publicEstimateApproval.errors.${status}`, {
    defaultValue: loadErrorFallback(),
  })
}
/** After these statuses the link can no longer be used, so the page shows only the message. */
const TERMINAL_STATUSES = new Set([404, 409, 410])

const formatMoney = (value: string) => formatCurrency(Number(value))
const formatQuantity = (value: string) => formatNumber(Number(value), { maximumFractionDigits: 3 })

function describeError(error: unknown): string {
  if (error instanceof PublicEstimateApprovalError) {
    return errorMessageForStatus(error.status)
  }
  return loadErrorFallback()
}

/** Adds a <meta> tag to the head and returns the cleanup that removes it again. */
function ensureMeta(name: string, content: string): () => void {
  let element = document.head.querySelector<HTMLMetaElement>(`meta[name="${name}"]`)
  const created = !element
  if (!element) {
    element = document.createElement('meta')
    element.name = name
    document.head.appendChild(element)
  }
  const previous = element.content
  element.content = content
  return () => {
    if (created) element?.remove()
    else if (element) element.content = previous
  }
}

function addressLine(zip: string | null, city: string | null): string {
  return [zip, city].filter(Boolean).join(' ')
}

function AddressBlock({ title, lines }: { title: string; lines: Array<string | null | undefined> }) {
  const visible = lines.filter((line): line is string => Boolean(line))
  return (
    <div className='min-w-0'>
      <h2 className='text-xs font-semibold uppercase tracking-wide text-slate-500'>{title}</h2>
      <div className='mt-1 space-y-0.5 text-sm break-words'>
        {visible.map((line, index) => (
          <p key={`${index}-${line}`}>{line}</p>
        ))}
      </div>
    </div>
  )
}

function EstimateSummary({ view }: { view: PublicEstimateView }) {
  const { t } = useTranslation('workshop')
  const { document: doc, seller, customer, vehicle, order, lines, totals } = view
  const showGross = doc.price_display === 'GROSS'
  const customerName = customer.company_name || `${customer.first_name} ${customer.last_name}`.trim()
  const vehicleLine = [
    `${vehicle.make} ${vehicle.model}`.trim(),
    vehicle.year ? String(vehicle.year) : null,
    vehicle.plate ? t('publicEstimateApproval.plate', { plate: vehicle.plate }) : null,
    vehicle.vin ? t('publicEstimateApproval.vin', { vin: vehicle.vin }) : null,
  ]
    .filter(Boolean)
    .join(' · ')

  return (
    <>
      <div className='grid grid-cols-1 gap-4 sm:grid-cols-2'>
        <AddressBlock
          title={t('publicEstimateApproval.workshop')}
          lines={[
            seller.name,
            seller.address_street,
            addressLine(seller.address_zip, seller.address_city),
            seller.vat_id ? t('publicEstimateApproval.uid', { vatId: seller.vat_id }) : null,
          ]}
        />
        <AddressBlock
          title={t('publicEstimateApproval.customer')}
          lines={[
            customerName,
            customer.address_street,
            addressLine(customer.address_zip, customer.address_city),
            customer.vat_id ? t('publicEstimateApproval.uid', { vatId: customer.vat_id }) : null,
          ]}
        />
      </div>

      <p className='text-sm break-words'>
        <span className='font-medium'>{t('publicEstimateApproval.vehicle')}</span> {vehicleLine}
        {order.odometer > 0 && ` · ${formatQuantity(String(order.odometer))} km`}
      </p>

      {doc.free_of_charge && <p className='text-sm text-slate-600'>{t('publicEstimateApproval.freeOfCharge')}</p>}

      <ul className='divide-y rounded-md border bg-white' aria-label={t('publicEstimateApproval.lineItemsAria')}>
        {lines.map((line, index) => (
          <li key={`${line.item_no}-${index}`} className='flex items-start justify-between gap-3 p-3 text-sm'>
            <div className='min-w-0'>
              <p className='break-words font-medium'>{line.description}</p>
              <p className='text-xs text-slate-500'>
                {formatQuantity(line.quantity)} × {formatMoney(line.unit_price)}
                {showGross ? ` ${t('publicEstimateApproval.gross')}` : ` ${t('publicEstimateApproval.net')}`}
              </p>
            </div>
            <span className='shrink-0 tabular-nums'>{formatMoney(showGross ? line.gross : line.net)}</span>
          </li>
        ))}
      </ul>

      <dl className='space-y-1 text-sm'>
        <div className='flex justify-between gap-3'>
          <dt>{t('publicEstimateApproval.totalNet')}</dt>
          <dd className='tabular-nums'>{formatMoney(totals.total_net)}</dd>
        </div>
        <div className='flex justify-between gap-3'>
          <dt>{t('publicEstimateApproval.tax')}</dt>
          <dd className='tabular-nums'>{formatMoney(totals.total_tax)}</dd>
        </div>
        <div className='flex justify-between gap-3 text-base font-semibold'>
          <dt>{t('publicEstimateApproval.totalGross')}</dt>
          <dd className='tabular-nums'>{formatMoney(totals.total_gross)}</dd>
        </div>
      </dl>
    </>
  )
}

interface DecisionFormProps {
  token: string
  paragraphs: string[]
  onDecided: (result: PublicEstimateDecisionResult) => void
  onTerminalError: (message: string) => void
}

function DecisionForm({ token, paragraphs, onDecided, onTerminalError }: DecisionFormProps) {
  const { t } = useTranslation('workshop')
  const [legalAccepted, setLegalAccepted] = useState(false)
  const [b2cAccepted, setB2cAccepted] = useState(false)
  const [name, setName] = useState('')
  const [confirmingDecline, setConfirmingDecline] = useState(false)
  const [submitting, setSubmitting] = useState(false)
  const [error, setError] = useState<string | null>(null)

  const trimmedName = name.trim()
  // Draft wording, pending lawyer sign-off (ADR-0025 §7): the confirmation labels and button text may change.
  const canApprove = legalAccepted && b2cAccepted && trimmedName.length >= MIN_NAME_LENGTH && !submitting

  const submit = async (decision: 'APPROVE' | 'DECLINE') => {
    setError(null)
    setSubmitting(true)
    try {
      const result = await submitPublicEstimateDecision(
        token,
        decision === 'APPROVE'
          ? {
              decision,
              typed_full_name: trimmedName,
              legal_blocks_accepted: legalAccepted,
              b2c_declaration_accepted: b2cAccepted,
            }
          : { decision, legal_blocks_accepted: false, b2c_declaration_accepted: false },
      )
      onDecided(result)
    } catch (submitError: unknown) {
      if (submitError instanceof PublicEstimateApprovalError && TERMINAL_STATUSES.has(submitError.status)) {
        onTerminalError(describeError(submitError))
        return
      }
      setConfirmingDecline(false)
      setError(
        submitError instanceof PublicEstimateApprovalError && submitError.status === 422
          ? t('publicEstimateApproval.validation422')
          : submitError instanceof PublicEstimateApprovalError
            ? errorMessageForStatus(submitError.status)
            : t('publicEstimateApproval.submitFailed'),
      )
    } finally {
      setSubmitting(false)
    }
  }

  return (
    <section className='space-y-4' aria-label={t('publicEstimateApproval.decisionSectionAria')}>
      <div className='space-y-2 rounded-md border bg-white p-3 text-sm' data-testid='legal-paragraphs'>
        {paragraphs.map((paragraph, index) => (
          <p key={`${index}-${paragraph.slice(0, 16)}`} className='break-words'>
            {paragraph}
          </p>
        ))}
      </div>

      <div className='space-y-3'>
        <div className='flex items-start gap-2'>
          <Checkbox
            id='approval-legal'
            checked={legalAccepted}
            disabled={submitting}
            onCheckedChange={(checked) => setLegalAccepted(checked === true)}
          />
          <Label htmlFor='approval-legal' className='font-normal leading-snug'>
            {t('publicEstimateApproval.legalAccepted')}
          </Label>
        </div>
        <div className='flex items-start gap-2'>
          <Checkbox
            id='approval-b2c'
            checked={b2cAccepted}
            disabled={submitting}
            onCheckedChange={(checked) => setB2cAccepted(checked === true)}
          />
          <Label htmlFor='approval-b2c' className='font-normal leading-snug'>
            {t('publicEstimateApproval.b2cAccepted')}
          </Label>
        </div>
        <div className='space-y-1.5'>
          <Label htmlFor='approval-name'>{t('publicEstimateApproval.fullName')}</Label>
          <Input
            id='approval-name'
            value={name}
            maxLength={MAX_NAME_LENGTH}
            autoComplete='name'
            disabled={submitting}
            onChange={(event) => setName(event.target.value)}
          />
        </div>
      </div>

      {error && (
        <Alert variant='destructive'>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}

      <div className='flex flex-col gap-2'>
        <Button className='w-full' disabled={!canApprove} onClick={() => void submit('APPROVE')}>
          {submitting && !confirmingDecline ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
          {t('publicEstimateApproval.approve')}
        </Button>

        {confirmingDecline ? (
          <div className='space-y-2 rounded-md border p-3'>
            <p className='text-sm'>{t('publicEstimateApproval.declineConfirm')}</p>
            <div className='flex flex-col gap-2 sm:flex-row'>
              <Button variant='destructive' disabled={submitting} onClick={() => void submit('DECLINE')}>
                {t('publicEstimateApproval.declineYes')}
              </Button>
              <Button variant='outline' disabled={submitting} onClick={() => setConfirmingDecline(false)}>
                {t('publicEstimateApproval.back')}
              </Button>
            </div>
          </div>
        ) : (
          <Button variant='outline' className='w-full' disabled={submitting} onClick={() => setConfirmingDecline(true)}>
            {t('publicEstimateApproval.decline')}
          </Button>
        )}
      </div>
    </section>
  )
}

type PageState =
  | { kind: 'loading' }
  | { kind: 'error'; message: string }
  | { kind: 'view'; view: PublicEstimateView }
  | { kind: 'decided'; result: PublicEstimateDecisionResult }

export interface PublicEstimateApprovalPageProps {
  token: string
}

/**
 * Public approval page for a sent Kostenvoranschlag. It renders outside AuthProvider and the app shell and
 * has no link into the app. The token is read once per mount, and the page never refetches after a decision.
 */
export function PublicEstimateApprovalPage({ token }: PublicEstimateApprovalPageProps) {
  const { t } = useTranslation('workshop')
  const [workshopLocaleReady, setWorkshopLocaleReady] = useState(() =>
    i18n.hasResourceBundle(i18n.language, 'workshop'),
  )
  const [state, setState] = useState<PageState>({ kind: 'loading' })

  useEffect(() => {
    if (workshopLocaleReady) return
    void ensureNamespaceLoaded('workshop').then(() => setWorkshopLocaleReady(true))
  }, [workshopLocaleReady])

  useEffect(() => {
    if (!workshopLocaleReady) return
    const previousTitle = document.title
    document.title = t('publicEstimateApproval.pageTitle')
    const removeRobots = ensureMeta('robots', 'noindex, nofollow')
    const removeReferrer = ensureMeta('referrer', 'no-referrer')
    return () => {
      document.title = previousTitle
      removeRobots()
      removeReferrer()
    }
  }, [t, workshopLocaleReady])

  useEffect(() => {
    if (!workshopLocaleReady) return
    const controller = new AbortController()
    setState({ kind: 'loading' })
    fetchPublicEstimate(token, controller.signal).then(
      (view) => {
        if (!controller.signal.aborted) setState({ kind: 'view', view })
      },
      (error: unknown) => {
        if (!controller.signal.aborted) setState({ kind: 'error', message: describeError(error) })
      },
    )
    return () => controller.abort()
  }, [token, workshopLocaleReady])

  if (!workshopLocaleReady) {
    return <PageLoader />
  }

  return (
    <main className='min-h-screen bg-slate-50 px-4 py-6'>
      <div className='mx-auto w-full max-w-2xl min-w-0'>
        {state.kind === 'loading' && (
          <p className='flex items-center gap-2 text-sm text-slate-600' role='status'>
            <Loader2 className='h-4 w-4 animate-spin' />
            {t('publicEstimateApproval.loading')}
          </p>
        )}

        {state.kind === 'error' && (
          <Alert variant='destructive'>
            <AlertDescription>{state.message}</AlertDescription>
          </Alert>
        )}

        {state.kind === 'view' && (
          <Card>
            <CardHeader className='space-y-1'>
              <CardTitle className='text-xl break-words'>
                {t('publicEstimateApproval.estimateTitle', { number: state.view.document.estimate_number })}
              </CardTitle>
              <p className='text-sm text-slate-500'>{t('publicEstimateApproval.version', { version: state.view.document.version })}</p>
            </CardHeader>
            <CardContent className='space-y-5'>
              <EstimateSummary view={state.view} />
              <p className='text-sm font-medium'>
                {t('publicEstimateApproval.validUntil', {
                  date: formatDateTime(state.view.document.valid_until),
                })}
              </p>
              <DecisionForm
                token={token}
                paragraphs={state.view.legal.paragraphs}
                onDecided={(result) => setState({ kind: 'decided', result })}
                onTerminalError={(message) => setState({ kind: 'error', message })}
              />
            </CardContent>
          </Card>
        )}

        {state.kind === 'decided' && (
          <Card>
            <CardHeader>
              <CardTitle className='text-xl'>{t('publicEstimateApproval.thankYou')}</CardTitle>
            </CardHeader>
            <CardContent className='space-y-1 text-sm' role='status'>
              <p className='font-medium'>{state.result.decision === 'APPROVED' ? t('publicEstimateApproval.approved') : t('publicEstimateApproval.declined')}</p>
              <p className='text-slate-600'>
                {state.result.decision === 'APPROVED'
                  ? t('publicEstimateApproval.approvedAt', { date: formatDateTime(state.result.decided_at) })
                  : t('publicEstimateApproval.decidedAt', { date: formatDateTime(state.result.decided_at) })}
              </p>
            </CardContent>
          </Card>
        )}
      </div>
    </main>
  )
}
