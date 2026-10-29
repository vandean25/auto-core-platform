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
import { TyreMeasurementForm } from './TyreMeasurementForm'

type Props = {
  parent: TyreMeasurementParent
  orderId: string
  readOnly?: boolean
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

export function TyreMeasurementSection({ parent, orderId, readOnly = false, onPhoto, pendingMediaIds, mediaUrls = {} }: Props) {
  const { t } = useTranslation('workshop')
  const role = useAuthSession().data?.activeRole
  const permitted = canRecordTyreMeasurement(role)
  const measurements = useTyreMeasurements(parent, permitted)
  const create = useCreateTyreMeasurement(parent)
  const navigate = useNavigate()
  const generatePdf = useGenerateWorkshopPdf()
  const [search, setSearch] = useSearchParams()
  const media = useOrderTyreMedia(orderId, parent.kind === 'order' && permitted && role !== 'TECH')
  const urls = { ...media.urls, ...mediaUrls }
  const editable = permitted && !readOnly
  const isOpen = search.get('action') === 'recordTyreMeasurement' && editable
  const close = () => setSearch((previous) => { const next = new URLSearchParams(previous); next.delete('action'); return next }, { replace: true })
  const form = editable && measurements.data && <TyreMeasurementForm initial={measurements.data.data[0]} pendingMediaIds={pendingMediaIds} mediaUrls={urls} onPhoto={onPhoto ?? media.uploadPhoto}
    onSave={async (body) => { await create.mutateAsync(body); if (parent.kind === 'order') close() }} />

  if (!permitted) return null
  return (
    <Card className="min-w-0">
      <CardHeader className="flex flex-wrap items-center justify-between gap-3 sm:flex-row">
        <CardTitle>{t('tyreReport.title')}</CardTitle>
        {parent.kind === 'order' && editable && <RegistryActionButton action={createWorkshopOrderTyreMeasurementAction(t)}
          record={{ id: orderId }} runContext={{ navigate, generatePdf, t }} role={role} className="min-h-11" />}
      </CardHeader>
      <CardContent className="space-y-4">
        <TyreMeasurementHistory measurements={measurements} mediaUrls={urls} />
        {parent.kind === 'check-in' && form}
      </CardContent>
      {parent.kind === 'order' && <Dialog open={isOpen} onOpenChange={(open) => { if (!open) close() }}>
        <DialogContent className="max-h-[90dvh] overflow-y-auto sm:max-w-3xl">
          <DialogHeader><DialogTitle>{t('tyreReport.record')}</DialogTitle></DialogHeader>
          {form}
        </DialogContent>
      </Dialog>}
    </Card>
  )
}
