import { useNavigate, useSearchParams } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { useAuthSession } from '@/api/auth-session'
import { useCreateTyreMeasurement, useTyreMeasurements, type TyreMeasurementParent } from '@/api/tyre-measurements'
import { useGenerateWorkshopPdf } from '@/api/workshop'
import { useWorkshopCheckIn, useWorkshopCheckInMedia, uploadWorkshopCheckInMedia } from '@/api/workshop-check-in'
import { translateApiError } from '@/api/api-error'
import { RegistryActionButton } from '@/features/actions/RegistryActionButton'
import { createWorkshopOrderTyreMeasurementAction } from '@/features/actions/work-order-row-actions'
import { canRecordTyreMeasurement } from '@/features/actions/action-role-predicates'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Skeleton } from '@/components/ui/skeleton'
import { generateId } from '@/lib/id'
import { useDelayedFlag } from '@/hooks/useDelayedFlag'
import { TyreReport } from './TyreReport'
import { TyreMeasurementForm, type TyreMeasurementFormState } from './TyreMeasurementForm'

type Props = {
  parent: TyreMeasurementParent
  orderId: string
  readOnly?: boolean
  onFormStateChange?: (state: TyreMeasurementFormState) => void
  onPhoto?: (file: File) => Promise<string>
  pendingMediaIds?: string[]
  mediaUrls?: Record<string, string>
}

function useOrderTyreMedia(orderId: string, enabled: boolean) {
  const checkIn = useWorkshopCheckIn(orderId, enabled)
  const media = useWorkshopCheckInMedia(orderId, enabled && Boolean(checkIn.data?.id))
  const urls = Object.fromEntries((media.data ?? []).filter((item) => item.preview_url).map((item) => [item.id, item.preview_url as string]))
  const uploadPhoto = enabled && checkIn.data?.status === 'DRAFT' ? async (file: File) => {
    const fresh = await checkIn.refetch({ throwOnError: true })
    const result = await uploadWorkshopCheckInMedia(orderId, { file, clientUploadId: generateId(), expectedRevision: fresh.data!.revision })
    await media.refetch()
    return result.media.id
  } : undefined
  return { urls, uploadPhoto }
}

function TyreMeasurementHistory({ measurements, mediaUrls }: {
  measurements: ReturnType<typeof useTyreMeasurements>
  mediaUrls: Record<string, string>
}) {
  const { t } = useTranslation('workshop')
  const showLoading = useDelayedFlag(measurements.isLoading)
  if (measurements.isLoading) return showLoading ? <Skeleton className="h-40 w-full" /> : null
  if (measurements.isError) return <form onSubmit={(event) => { event.preventDefault(); void measurements.refetch() }}>
    <p role="alert" className="text-sm text-destructive">{translateApiError(measurements.error)}</p>
    <Button type="submit" variant="outline">{t('checkIn.actions.retry')}</Button>
  </form>
  const latest = measurements.data?.data[0]
  return latest ? <TyreReport measurement={latest} mediaUrls={mediaUrls} /> : <p className="text-sm text-muted-foreground">{t('tyreReport.empty')}</p>
}

function OrderMeasurementDialog({
  open,
  onClose,
  title,
  children,
}: {
  open: boolean
  onClose: () => void
  title: string
  children: React.ReactNode
}) {
  return (
    <Dialog open={open} onOpenChange={(next) => { if (!next) onClose() }}>
      <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
        <DialogHeader><DialogTitle>{title}</DialogTitle></DialogHeader>
        {children}
      </DialogContent>
    </Dialog>
  )
}

function useOrderModalAction(active: boolean) {
  const [search, setSearch] = useSearchParams()
  const isModalOpen = active && search.get('action') === 'recordTyreMeasurement'
  const closeModal = () => setSearch((previous) => {
    const next = new URLSearchParams(previous)
    next.delete('action')
    return next
  }, { replace: true })
  return { isModalOpen, closeModal }
}

function OrderTyreSection({
  orderId,
  parent,
  readOnly,
  role,
  siteId,
  mediaUrls,
  onFormStateChange,
}: {
  orderId: string
  parent: TyreMeasurementParent
  readOnly: boolean
  role?: string
  siteId?: string | null
  mediaUrls: Record<string, string>
  onFormStateChange?: (state: TyreMeasurementFormState) => void
}) {
  const { t } = useTranslation('workshop')
  const navigate = useNavigate()
  const generatePdf = useGenerateWorkshopPdf()
  const measurements = useTyreMeasurements(parent, true)
  const create = useCreateTyreMeasurement(parent)

  const editable = !readOnly
  const { isModalOpen, closeModal } = useOrderModalAction(editable)
  const isTech = role === 'TECH'
  const media = useOrderTyreMedia(orderId, editable && !isTech)
  const urls = { ...media.urls, ...mediaUrls }

  const handleSave = async (body: Parameters<typeof create.mutateAsync>[0]) => {
    await create.mutateAsync(body)
    closeModal()
  }

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3 sm:flex-row">
        <CardTitle>{t('tyreReport.title')}</CardTitle>
        {editable && (
          <RegistryActionButton
            action={createWorkshopOrderTyreMeasurementAction(t)}
            record={{ id: orderId }}
            runContext={{ navigate, generatePdf, t }}
            role={role}
            className="min-h-11"
          />
        )}
      </CardHeader>
      <CardContent className="space-y-4">
        <TyreMeasurementHistory measurements={measurements} mediaUrls={urls} />
      </CardContent>
      <OrderMeasurementDialog open={isModalOpen} onClose={closeModal} title={t('tyreReport.record')}>
        {editable && measurements.data && (
          <TyreMeasurementForm
            key={siteId ?? 'no-site'}
            onStateChange={onFormStateChange}
            initial={measurements.data.data[0]}
            mediaUrls={urls}
            onPhoto={media.uploadPhoto}
            onSave={handleSave}
          />
        )}
      </OrderMeasurementDialog>
    </Card>
  )
}

function CheckInTyreSection({
  parent,
  readOnly,
  siteId,
  pendingMediaIds,
  mediaUrls,
  onFormStateChange,
  onPhoto,
}: {
  parent: TyreMeasurementParent
  readOnly: boolean
  siteId?: string | null
  pendingMediaIds?: string[]
  mediaUrls: Record<string, string>
  onFormStateChange?: (state: TyreMeasurementFormState) => void
  onPhoto?: (file: File) => Promise<string>
}) {
  const { t } = useTranslation('workshop')
  const measurements = useTyreMeasurements(parent, true)
  const create = useCreateTyreMeasurement(parent)
  const editable = !readOnly

  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3 sm:flex-row">
        <CardTitle>{t('tyreReport.title')}</CardTitle>
      </CardHeader>
      <CardContent className="space-y-4">
        <TyreMeasurementHistory measurements={measurements} mediaUrls={mediaUrls} />
        {editable && measurements.data && (
          <TyreMeasurementForm
            key={siteId ?? 'no-site'}
            onStateChange={onFormStateChange}
            initial={measurements.data.data[0]}
            pendingMediaIds={pendingMediaIds}
            mediaUrls={mediaUrls}
            onPhoto={onPhoto}
            onSave={async (body) => {
              await create.mutateAsync(body)
            }}
          />
        )}
      </CardContent>
    </Card>
  )
}

export function TyreMeasurementSection({
  parent,
  orderId,
  readOnly = false,
  onFormStateChange,
  onPhoto,
  pendingMediaIds,
  mediaUrls = {},
}: Props) {
  const session = useAuthSession().data
  const role = session?.activeRole
  if (!canRecordTyreMeasurement(role)) return null

  if (parent.kind === 'order') {
    return (
      <OrderTyreSection
        orderId={orderId}
        parent={parent}
        readOnly={readOnly}
        role={role}
        siteId={session?.activeSiteId}
        mediaUrls={mediaUrls}
        onFormStateChange={onFormStateChange}
      />
    )
  }

  return (
    <CheckInTyreSection
      parent={parent}
      readOnly={readOnly}
      siteId={session?.activeSiteId}
      pendingMediaIds={pendingMediaIds}
      mediaUrls={mediaUrls}
      onFormStateChange={onFormStateChange}
      onPhoto={onPhoto}
    />
  )
}
