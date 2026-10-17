import { useEffect, useMemo, useRef, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { generateId } from '@/lib/id'
import { useWorkshopOrder } from '@/api/workshop'
import {
  useCompleteWorkshopCheckIn,
  useCreateWorkshopCheckIn,
  useWorkshopCheckIn,
  useWorkshopCheckInMedia,
} from '@/api/workshop-check-in'
import { describeWorkshopCheckInError } from './check-in-errors'
import { CheckInSaveIndicator } from './CheckInSaveIndicator'
import { CheckInVehicleStep } from './CheckInVehicleStep'
import { CheckInConditionStep } from './CheckInConditionStep'
import { CheckInReviewStep } from './CheckInReviewStep'
import { useCheckInDraftAutosave } from './useCheckInDraftAutosave'

const STEPS = ['vehicle', 'condition', 'review'] as const
type CheckInStep = (typeof STEPS)[number]

type Props = {
  orderId: string
}

function canStartCheckIn(status: string | undefined) {
  return status === 'INTAKE' || status === 'IN_PROGRESS'
}

export function WorkshopCheckInFlow({ orderId }: Props) {
  const { t } = useTranslation('workshop')
  const navigate = useNavigate()
  const orderQuery = useWorkshopOrder(orderId)
  const checkInIdRef = useRef<string | null>(null)
  const createFailedRef = useRef(false)
  const createCheckIn = useCreateWorkshopCheckIn()
  const completeCheckIn = useCompleteWorkshopCheckIn()
  const [step, setStep] = useState<CheckInStep>('vehicle')
  const [localPreviewUrls, setLocalPreviewUrls] = useState<Record<string, string>>({})
  const [sessionMedia, setSessionMedia] = useState<
    import('@/api/workshop-check-in').WorkshopCheckInMedia[]
  >([])

  const checkInQuery = useWorkshopCheckIn(orderId, Boolean(orderQuery.data))
  const mediaQuery = useWorkshopCheckInMedia(
    orderId,
    Boolean(checkInQuery.data?.id),
  )

  const readOnly = checkInQuery.data?.status === 'COMPLETED'

  const {
    draft,
    patchDraft,
    patchCondition,
    saveStatus,
    flushBeforeNavigate,
  } = useCheckInDraftAutosave({
    orderId,
    record: checkInQuery.data,
    readOnly,
    onRevisionConflict: async () => {
      const result = await checkInQuery.refetch()
      return result.data ?? null
    },
  })

  useEffect(() => {
    if (!orderQuery.data || checkInQuery.isLoading) {
      return
    }
    if (checkInQuery.isError) {
      return
    }
    if (checkInQuery.data) {
      return
    }
    if (!canStartCheckIn(orderQuery.data.status)) {
      return
    }
    if (checkInIdRef.current || createFailedRef.current) {
      return
    }
    const id = generateId()
    checkInIdRef.current = id
    void createCheckIn
      .mutateAsync({ orderId, checkInId: id })
      .catch(async (error: unknown) => {
        toast.error(describeWorkshopCheckInError(error))
        checkInIdRef.current = null
        createFailedRef.current = true
        const refetched = await checkInQuery.refetch()
        if (refetched.data) {
          createFailedRef.current = false
        }
      })
  }, [
    checkInQuery.data,
    checkInQuery.isError,
    checkInQuery.isLoading,
    checkInQuery.refetch,
    createCheckIn,
    orderId,
    orderQuery.data,
  ])

  const stepIndex = STEPS.indexOf(step)
  const vehicleLabel = useMemo(() => {
    const vehicle = orderQuery.data?.vehicle
    if (!vehicle) {
      return ''
    }
    return `${vehicle.year} ${vehicle.make} ${vehicle.model}`
  }, [orderQuery.data?.vehicle])

  if (checkInQuery.isError) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">
          {describeWorkshopCheckInError(checkInQuery.error)}
        </p>
        <Button
          type="button"
          className="min-h-11"
          onClick={() => void checkInQuery.refetch()}
        >
          {t('checkIn.actions.retry')}
        </Button>
      </div>
    )
  }

  if (orderQuery.isLoading || checkInQuery.isLoading) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="check-in-loading">
        {t('checkIn.loading')}
      </p>
    )
  }

  if (!orderQuery.data) {
    return (
      <p className="text-sm text-destructive">{t('checkIn.orderMissing')}</p>
    )
  }

  if (!canStartCheckIn(orderQuery.data.status) && !checkInQuery.data) {
    return (
      <div className="space-y-4">
        <p className="text-sm text-destructive">{t('checkIn.errors.CHECK_IN_ORDER_STATUS')}</p>
        <Button asChild className="min-h-11">
          <Link to={APP_ROUTE_PATHS.workshopOrderDetail.replace(':id', orderId)}>
            {t('checkIn.actions.backToOrder')}
          </Link>
        </Button>
      </div>
    )
  }

  if (!checkInQuery.data || !draft) {
    return (
      <p className="text-sm text-muted-foreground" data-testid="check-in-loading">
        {t('checkIn.initializing')}
      </p>
    )
  }

  const goToStep = async (next: CheckInStep) => {
    await flushBeforeNavigate()
    setStep(next)
  }

  const handleComplete = async () => {
    const revision = await flushBeforeNavigate()
    if (revision === undefined) {
      return
    }
    try {
      await completeCheckIn.mutateAsync({
        orderId,
        expectedRevision: revision,
      })
      toast.success(t('checkIn.complete.success'))
      await checkInQuery.refetch()
    } catch (error: unknown) {
      toast.error(describeWorkshopCheckInError(error))
    }
  }

  return (
    <div className="mx-auto flex w-full max-w-4xl flex-col gap-6 px-4 pb-10 pt-2">
      <header className="flex flex-col gap-3 sm:flex-row sm:items-start sm:justify-between">
        <div>
          <p className="text-sm text-slate-500">{t('checkIn.flowLabel')}</p>
          <h1 className="text-2xl font-semibold tracking-tight">
            {orderQuery.data.order_number}
          </h1>
          <p className="text-sm text-slate-500">{vehicleLabel}</p>
        </div>
        <CheckInSaveIndicator status={saveStatus} />
      </header>

      {readOnly && (
        <p
          className="rounded-md border border-amber-200 bg-amber-50 px-3 py-2 text-sm text-amber-900"
          role="status"
        >
          {t('checkIn.completedBanner')}
        </p>
      )}

      <nav aria-label={t('checkIn.stepNavAria')} className="flex flex-wrap gap-2">
        {STEPS.map((id) => (
          <Button
            key={id}
            type="button"
            variant={step === id ? 'default' : 'outline'}
            className="min-h-11"
            aria-current={step === id ? 'step' : undefined}
            onClick={() => void goToStep(id)}
          >
            {t(`checkIn.steps.${id}.nav`)}
          </Button>
        ))}
      </nav>

      {step === 'vehicle' && (
        <CheckInVehicleStep
          orderId={orderId}
          draft={draft}
          readOnly={readOnly}
          onPatch={patchDraft}
          onPatchCondition={patchCondition}
        />
      )}
      {step === 'condition' && (
        <CheckInConditionStep
          orderId={orderId}
          draft={draft}
          readOnly={readOnly}
          expectedRevision={checkInQuery.data.revision}
          media={[
            ...(mediaQuery.data ?? []),
            ...sessionMedia.filter(
              (item) => !(mediaQuery.data ?? []).some((existing) => existing.id === item.id),
            ),
          ]}
          localPreviewUrls={localPreviewUrls}
          onRegisterPreview={(mediaId, objectUrl) =>
            setLocalPreviewUrls((previous) => ({ ...previous, [mediaId]: objectUrl }))
          }
          onMediaUploaded={(item) =>
            setSessionMedia((previous) =>
              previous.some((entry) => entry.id === item.id)
                ? previous
                : [...previous, item],
            )
          }
          onPatch={patchDraft}
          onRevisionBump={() => {
            void checkInQuery.refetch()
          }}
        />
      )}
      {step === 'review' && (
        <CheckInReviewStep
          orderId={orderId}
          orderNumber={orderQuery.data.order_number ?? orderId}
          vehicleLabel={vehicleLabel}
          draft={draft}
          record={checkInQuery.data}
        />
      )}

      <footer className="flex flex-wrap items-center justify-between gap-3 border-t pt-4">
        <Button
          type="button"
          variant="outline"
          className="min-h-11"
          onClick={() => navigate(APP_ROUTE_PATHS.workshopOrderDetail.replace(':id', orderId))}
        >
          {t('checkIn.actions.exit')}
        </Button>
        <div className="flex flex-wrap gap-2">
          {stepIndex > 0 && (
            <Button
              type="button"
              variant="outline"
              className="min-h-11"
              onClick={() => void goToStep(STEPS[stepIndex - 1])}
            >
              {t('checkIn.actions.back')}
            </Button>
          )}
          {stepIndex < STEPS.length - 1 && (
            <Button
              type="button"
              className="min-h-11"
              data-testid="check-in-next"
              onClick={() => void goToStep(STEPS[stepIndex + 1])}
            >
              {t('checkIn.actions.next')}
            </Button>
          )}
          {step === 'review' && !readOnly && (
            <Button
              type="button"
              className="min-h-11"
              data-testid="check-in-complete"
              disabled={completeCheckIn.isPending}
              onClick={() => void handleComplete()}
            >
              {completeCheckIn.isPending
                ? t('checkIn.complete.pending')
                : t('checkIn.complete.action')}
            </Button>
          )}
        </div>
      </footer>
    </div>
  )
}
