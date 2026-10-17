import { useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { generateId } from '@/lib/id'
import { getErrorMessage } from '@/lib/error-utils'
import {
  useAbortRegistrationIntake,
  useApplyRegistrationIntake,
  useCreateRegistrationIntake,
  useDeleteRegistrationIntake,
  useRegistrationIntake,
  useRegistrationIntakeOrder,
  type RegistrationIntakeDetail,
} from '@/api/workshop'
import { RegistrationDocumentReview } from './RegistrationDocumentReview'

type Props = {
  odometer: string
  fuelLevel: string
  notes: string
  onOrderCreated: (orderId: string) => void
}

export function RegistrationDocumentIntakeStep({
  odometer,
  fuelLevel,
  notes,
  onOrderCreated,
}: Props) {
  const { t } = useTranslation('workshop')
  const [intakeId, setIntakeId] = useState<string | null>(null)
  const [frontFile, setFrontFile] = useState<File | null>(null)
  const [backFile, setBackFile] = useState<File | null>(null)
  const uploadKeyRef = useRef(generateId())
  const createIntake = useCreateRegistrationIntake()
  const intakeQuery = useRegistrationIntake(intakeId)
  const applyIntake = useApplyRegistrationIntake()
  const createOrder = useRegistrationIntakeOrder()
  const abortIntake = useAbortRegistrationIntake()
  const deleteIntake = useDeleteRegistrationIntake()

  const intake: RegistrationIntakeDetail | undefined =
    intakeQuery.data ?? (createIntake.data as RegistrationIntakeDetail | undefined)

  async function handleUpload() {
    if (!frontFile) {
      toast.error(t('registrationIntake.toastFrontRequired'))
      return
    }
    const files = backFile ? [frontFile, backFile] : [frontFile]
    const sides: ('FRONT' | 'BACK')[] = backFile ? ['FRONT', 'BACK'] : ['FRONT']
    try {
      const created = await createIntake.mutateAsync({
        files,
        sides,
        idempotencyKey: uploadKeyRef.current,
      })
      setIntakeId(created.id)
      if (created.state === 'FAILED') {
        toast.error(created.failureCode ?? 'Extraction failed')
      }
    } catch (err) {
      toast.error(getErrorMessage(err, t('registrationIntake.uploadFailed')))
    }
  }

  return (
    <div className="space-y-4">
      {!intakeId ? (
        <div className="space-y-3 border rounded-lg p-3">
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="registration-intake-front">
              {t('registrationIntake.frontLabel')}
            </label>
            <Input
              id="registration-intake-front"
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => setFrontFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <div className="grid gap-2">
            <label className="text-sm font-medium" htmlFor="registration-intake-back">
              {t('registrationIntake.backLabel')}
            </label>
            <Input
              id="registration-intake-back"
              type="file"
              accept="image/jpeg,image/png,application/pdf"
              onChange={(e) => setBackFile(e.target.files?.[0] ?? null)}
            />
          </div>
          <Button
            type="button"
            disabled={createIntake.isPending || !frontFile}
            onClick={() => void handleUpload()}
          >
            {createIntake.isPending ? t('registrationIntake.reading') : t('registrationIntake.uploadReview')}
          </Button>
        </div>
      ) : null}

      {intake && intake.state !== 'FAILED' ? (
        <RegistrationDocumentReview
          intake={intake}
          onApply={async (body) => {
            await applyIntake.mutateAsync({ id: intake.id, body })
            toast.success(t('registrationIntake.toastConfirmed'))
          }}
          onCreateOrder={async () => {
            const odometerValue = Number.parseInt(odometer, 10)
            const fuelValue = Number.parseInt(fuelLevel, 10)
            if (!Number.isFinite(odometerValue) || odometerValue < 0) {
              toast.error(t('registrationIntake.toastOdometerRequired'))
              return
            }
            const result = await createOrder.mutateAsync({
              id: intake.id,
              odometer: odometerValue,
              fuelLevel: Number.isFinite(fuelValue) ? fuelValue : 50,
              notes: notes || undefined,
            })
            if (result.workshopOrderId) {
              toast.success(t('registrationIntake.toastOrderCreated'))
              onOrderCreated(result.workshopOrderId)
            }
          }}
          onAbort={async () => {
            await abortIntake.mutateAsync(intake.id)
            setIntakeId(null)
            uploadKeyRef.current = generateId()
          }}
          onDelete={async () => {
            await deleteIntake.mutateAsync(intake.id)
            setIntakeId(null)
            uploadKeyRef.current = generateId()
          }}
        />
      ) : null}

      {intake?.state === 'FAILED' ? (
        <p className="text-sm text-destructive">
          {t('registrationIntake.extractionFailed', {
            code: intake.failureCode ?? t('registrationIntake.unknown'),
          })}
        </p>
      ) : null}
    </div>
  )
}
