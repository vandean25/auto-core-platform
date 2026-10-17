import { useMemo, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { getErrorMessage } from '@/lib/error-utils'

type RegistrationFieldEvidence = {
  raw: string | null
  normalized: string | number | { firstName: string; lastName: string } | null
  uncertainty: number | null
  cycle?: 'WLTP' | 'NEDC' | string | null
}

type MatchCustomer = { id: string; firstName?: string; lastName?: string }
type MatchVehicle = { id: string; customerId?: string | null }

type RegistrationIntakeDetail = {
  id: string
  state: string
  appliedWorkshopOrderId?: string | null
  failureCode?: string | null
  evidence?: {
    documentKind: string
    warnings: string[]
    fields: Record<string, RegistrationFieldEvidence>
  }
  matchSnapshot?: {
    cases: string[]
    customers: MatchCustomer[]
    vehicles: MatchVehicle[]
  }
}

type Props = {
  intake: RegistrationIntakeDetail
  onApply: (body: Record<string, unknown>) => Promise<void>
  onStartCheckIn: () => Promise<void>
  onContinueCheckIn: (workshopOrderId: string) => void
  onAbort: () => Promise<void>
  onDelete: () => Promise<void>
}

const LOW_CONFIDENCE = 0.34

const BLOCKING_CASES = [
  'LOW_CONFIDENCE',
  'INVALID_VIN',
  'NATIONALCODE_LOOKS_LIKE_VIN',
  'NATIONALCODE_CONFLICT',
  'FIRST_REGISTRATION_CONFLICT',
  'CO2_CONFLICT',
] as const

export function RegistrationDocumentReview({
  intake,
  onApply,
  onStartCheckIn,
  onContinueCheckIn,
  onAbort,
  onDelete,
}: Props) {
  const { t } = useTranslation('workshop')
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cases = intake.matchSnapshot?.cases ?? []
  const fields = intake.evidence?.fields ?? {}
  const customers = intake.matchSnapshot?.customers ?? []
  const vehicles = intake.matchSnapshot?.vehicles ?? []

  const [selectedCustomerId, setSelectedCustomerId] = useState<string | null>(
    customers.length === 1 ? customers[0].id : null,
  )
  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(
    vehicles.length === 1 ? vehicles[0].id : null,
  )
  const [ownershipConfirmed, setOwnershipConfirmed] = useState(false)

  const holder = fields.holder?.normalized as { firstName: string; lastName: string } | null
  const ownershipConflict = cases.includes('OWNERSHIP_CONFLICT')
  const matchedVehicle = vehicles.find((v) => v.id === (selectedVehicleId ?? vehicles[0]?.id))

  const blockingCase = BLOCKING_CASES.find((c) => cases.includes(c))
  const illegible = intake.evidence?.warnings.includes('ILLEGIBLE')
  const wrongDocument = intake.evidence?.documentKind !== 'AT_ZULASSUNGSSCHEIN'

  const canApply = useMemo(() => {
    if (intake.state !== 'AWAITING_REVIEW') return false
    if (wrongDocument || illegible || blockingCase) return false
    if (ownershipConflict && !ownershipConfirmed) return false
    if (customers.length > 1 && !selectedCustomerId) return false
    if (vehicles.length > 1 && !selectedVehicleId) return false
    return Boolean(holder)
  }, [
    intake.state,
    wrongDocument,
    illegible,
    blockingCase,
    ownershipConflict,
    ownershipConfirmed,
    customers.length,
    selectedCustomerId,
    vehicles.length,
    selectedVehicleId,
    holder,
  ])

  function buildApplyBody(): Record<string, unknown> {
    const co2CycleKnown =
      fields.co2?.cycle === 'NEDC' || fields.co2?.cycle === 'WLTP'
    const co2ValueKnown =
      fields.co2?.normalized != null && co2CycleKnown
    const body: Record<string, unknown> = {
      vin: fields.vin?.normalized ?? null,
      plate: String(fields.plate?.normalized ?? ''),
      holder,
      nationalcode: cases.includes('MISSING_NATIONALCODE')
        ? null
        : (fields.nationalcode?.normalized as string | null),
      firstRegistration: fields.firstRegistration?.normalized ?? null,
      co2: co2ValueKnown
        ? {
            value: Number(fields.co2!.normalized),
            cycle: fields.co2!.cycle as 'WLTP' | 'NEDC',
          }
        : null,
    }
    if (!cases.includes('EXISTING_VEHICLE')) {
      body.make = fields.make?.normalized as string | undefined
      body.model = fields.model?.normalized as string | undefined
      body.year = fields.year?.normalized as number | undefined
    }
    if (
      cases.includes('EXISTING_CUSTOMER') ||
      cases.includes('DUPLICATE_CUSTOMERS') ||
      selectedCustomerId
    ) {
      body.customerId = selectedCustomerId ?? customers[0]?.id
    }
    if (
      cases.includes('EXISTING_VEHICLE') ||
      cases.includes('DUPLICATE_VEHICLES') ||
      selectedVehicleId
    ) {
      body.vehicleId = selectedVehicleId ?? vehicles[0]?.id
    }
    if (ownershipConflict && ownershipConfirmed && matchedVehicle) {
      body.ownershipCorrection = {
        expectedCustomerId: matchedVehicle.customerId ?? null,
        nextCustomerId: selectedCustomerId ?? customers[0]?.id,
      }
    }
    return body
  }

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(getErrorMessage(err, t('registrationReview.actionFailed')))
    } finally {
      setBusy(false)
    }
  }

  return (
    <div className="space-y-4">
      <div className="flex items-center gap-2">
        <StatusBadge status={intake.state} />
        {cases.map((caseName) => (
          <span key={caseName} className="text-xs text-muted-foreground">{caseName}</span>
        ))}
      </div>
      {error && (
        <Alert variant="destructive">
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      )}
      {customers.length > 1 && (
        <div className="space-y-2 text-sm">
          <p className="font-medium">{t('registrationReview.selectCustomer')}</p>
          {customers.map((c) => (
            <label key={c.id} className="flex items-center gap-2">
              <input
                type="radio"
                name="customer"
                checked={selectedCustomerId === c.id}
                onChange={() => setSelectedCustomerId(c.id)}
              />
              {c.firstName ?? ''} {c.lastName ?? ''}
            </label>
          ))}
        </div>
      )}
      {vehicles.length > 1 && (
        <div className="space-y-2 text-sm">
          <p className="font-medium">{t('registrationReview.selectVehicle')}</p>
          {vehicles.map((v) => (
            <label key={v.id} className="flex items-center gap-2">
              <input
                type="radio"
                name="vehicle"
                checked={selectedVehicleId === v.id}
                onChange={() => setSelectedVehicleId(v.id)}
              />
              {v.id}
            </label>
          ))}
        </div>
      )}
      {ownershipConflict && (
        <label className="flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={ownershipConfirmed}
            onChange={(e) => setOwnershipConfirmed(e.target.checked)}
          />
          {t('registrationReview.ownershipConfirm')}
        </label>
      )}
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {Object.entries(fields).map(([key, value]) => (
          <div key={key}>
            <dt className="font-medium">{key}</dt>
            <dd>
              {typeof value.normalized === 'object'
                ? `${value.normalized?.firstName ?? ''} ${value.normalized?.lastName ?? ''}`
                : String(value.normalized ?? '—')}
              {value.uncertainty != null && value.uncertainty > LOW_CONFIDENCE && (
                <span className="text-amber-600">{t('registrationReview.lowConfidence')}</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        {canApply && (
          <Button disabled={busy} onClick={() => run(() => onApply(buildApplyBody()))}>
            {t('registrationReview.confirmIdentity')}
          </Button>
        )}
        {intake.state === 'APPLIED' && intake.appliedWorkshopOrderId ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => onContinueCheckIn(intake.appliedWorkshopOrderId!)}
          >
            {t('registrationReview.continueCheckIn')}
          </Button>
        ) : null}
        {intake.state === 'APPLIED' && !intake.appliedWorkshopOrderId ? (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => run(() => onStartCheckIn())}
          >
            {t('registrationReview.startCheckIn')}
          </Button>
        ) : null}
        {intake.state !== 'APPLIED' && (
          <>
            <Button variant="outline" disabled={busy} onClick={() => run(onAbort)}>
              {t('registrationReview.abort')}
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => run(onDelete)}>
              {t('registrationReview.delete')}
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
