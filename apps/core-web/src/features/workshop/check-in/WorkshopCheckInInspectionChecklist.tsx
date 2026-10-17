import { useTranslation } from 'react-i18next'
import { WorkshopTaskInspectionChecklistView } from '@/components/workshop/WorkshopTaskInspectionChecklistView'
import {
  useUpdateWorkshopCheckInInspection,
  useWorkshopCheckIn,
  useWorkshopCheckInInspection,
} from '@/api/workshop-check-in'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { useEffect } from 'react'

type Props = {
  orderId: string
}

export function WorkshopCheckInInspectionChecklist({ orderId }: Props) {
  const { t } = useTranslation('workshop')
  useEffect(() => {
    void ensureNamespaceLoaded('workshop')
  }, [])

  const checkInQuery = useWorkshopCheckIn(orderId)
  const inspectionQuery = useWorkshopCheckInInspection(
    orderId,
    Boolean(checkInQuery.data?.inspection_id),
  )
  const updateInspection = useUpdateWorkshopCheckInInspection()

  if (checkInQuery.isError || inspectionQuery.isError) {
    return (
      <p className="text-sm text-destructive">
        {t('checkIn.inspection.loadError')}
      </p>
    )
  }

  if (!checkInQuery.data?.inspection_id || !inspectionQuery.data) {
    return null
  }

  const readOnly = checkInQuery.data.status === 'COMPLETED'

  return (
    <WorkshopTaskInspectionChecklistView
      checklist={inspectionQuery.data}
      readOnly={readOnly}
      saving={updateInspection.isPending}
      onSave={async (itemId, values) => {
        try {
          await updateInspection.mutateAsync({
            orderId,
            expectedRevision: checkInQuery.data.revision,
            items: [
              {
                id: itemId,
                ...(values.passed !== undefined && { passed: values.passed }),
                ...(values.notes !== undefined && { notes: values.notes }),
              },
            ],
          })
        } catch {
          throw new Error(t('checkIn.inspection.saveError'))
        }
      }}
    />
  )
}
