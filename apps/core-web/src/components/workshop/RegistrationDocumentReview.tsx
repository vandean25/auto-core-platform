import { useState } from 'react'
import { Button } from '@/components/ui/button'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { getErrorMessage } from '@/lib/error-utils'

type RegistrationFieldEvidence = {
  raw: string | null
  normalized: string | number | { firstName: string; lastName: string } | null
  uncertainty: number | null
}

type RegistrationIntakeDetail = {
  id: string
  state: string
  failureCode?: string | null
  evidence?: {
    documentKind: string
    warnings: string[]
    fields: Record<string, RegistrationFieldEvidence>
  }
  matchSnapshot?: { cases: string[]; customers: { id: string }[]; vehicles: { id: string }[] }
}

type Props = {
  intake: RegistrationIntakeDetail
  onApply: (body: Record<string, unknown>) => Promise<void>
  onCreateOrder: (body: Record<string, unknown>) => Promise<void>
  onAbort: () => Promise<void>
  onDelete: () => Promise<void>
}

const LOW_CONFIDENCE = 0.34

export function RegistrationDocumentReview({
  intake,
  onApply,
  onCreateOrder,
  onAbort,
  onDelete,
}: Props) {
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const cases = intake.matchSnapshot?.cases ?? []
  const fields = intake.evidence?.fields ?? {}
  const fieldConflict = cases.some((c) =>
    ['NATIONALCODE_CONFLICT', 'FIRST_REGISTRATION_CONFLICT', 'CO2_CONFLICT'].includes(c),
  )
  const lowConfidence = cases.includes('LOW_CONFIDENCE')
  const canApply =
    intake.state === 'AWAITING_REVIEW' &&
    !lowConfidence &&
    !fieldConflict &&
    intake.evidence?.documentKind === 'AT_ZULASSUNGSSCHEIN'

  const holder = fields.holder?.normalized as { firstName: string; lastName: string } | null

  async function run(action: () => Promise<void>) {
    setBusy(true)
    setError(null)
    try {
      await action()
    } catch (err) {
      setError(getErrorMessage(err, 'Action failed'))
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
      <dl className="grid grid-cols-2 gap-2 text-sm">
        {Object.entries(fields).map(([key, value]) => (
          <div key={key}>
            <dt className="font-medium">{key}</dt>
            <dd>
              {typeof value.normalized === 'object'
                ? `${value.normalized?.firstName ?? ''} ${value.normalized?.lastName ?? ''}`
                : String(value.normalized ?? '—')}
              {value.uncertainty != null && value.uncertainty > LOW_CONFIDENCE && (
                <span className="text-amber-600"> (low confidence)</span>
              )}
            </dd>
          </div>
        ))}
      </dl>
      <div className="flex flex-wrap gap-2">
        {canApply && holder && (
          <Button
            disabled={busy}
            onClick={() =>
              run(() =>
                onApply({
                  vin: fields.vin?.normalized ?? null,
                  plate: String(fields.plate?.normalized ?? ''),
                  holder,
                  nationalcode:
                    cases.includes('MISSING_NATIONALCODE')
                      ? null
                      : (fields.nationalcode?.normalized as string | null),
                  firstRegistration: fields.firstRegistration?.normalized ?? null,
                  co2:
                    fields.co2?.normalized != null
                      ? {
                          value: Number(fields.co2.normalized),
                          cycle: (fields.co2 as { cycle?: string }).cycle ?? 'WLTP',
                        }
                      : null,
                  make: fields.make?.normalized as string | undefined,
                  model: fields.model?.normalized as string | undefined,
                  year: fields.year?.normalized as number | undefined,
                }),
              )
            }
          >
            Confirm identity
          </Button>
        )}
        {intake.state === 'APPLIED' && (
          <Button
            variant="secondary"
            disabled={busy}
            onClick={() => run(() => onCreateOrder({ odometer: 0, fuelLevel: 50 }))}
          >
            Create workshop order
          </Button>
        )}
        {intake.state !== 'APPLIED' && (
          <>
            <Button variant="outline" disabled={busy} onClick={() => run(onAbort)}>
              Abort
            </Button>
            <Button variant="ghost" disabled={busy} onClick={() => run(onDelete)}>
              Delete
            </Button>
          </>
        )}
      </div>
    </div>
  )
}
