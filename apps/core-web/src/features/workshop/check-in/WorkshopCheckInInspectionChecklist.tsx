import { useTranslation } from 'react-i18next'
import { useQueryClient } from '@tanstack/react-query'
import {
  WorkshopTaskInspectionChecklistView,
  type InspectionChecklistViewLabels,
} from '@/components/workshop/WorkshopTaskInspectionChecklistView'
import {
  useUpdateWorkshopCheckInInspection,
  useWorkshopCheckIn,
  useWorkshopCheckInInspection,
  workshopCheckInKeys,
  type WorkshopCheckIn,
} from '@/api/workshop-check-in'
import { ensureNamespaceLoaded } from '@/lib/i18n'
import { useEffect, useMemo } from 'react'

type Props = {
  orderId: string
}

export function WorkshopCheckInInspectionChecklist({ orderId }: Props) {
  const { t } = useTranslation('workshop')
  const queryClient = useQueryClient()
  useEffect(() => {
    void ensureNamespaceLoaded('workshop')
  }, [])

  const checklistLabels = useMemo<InspectionChecklistViewLabels>(
    () => ({
      sectionAriaLabel: t('checkIn.inspection.sectionLabel'),
      description: t('checkIn.inspection.description'),
      passButton: t('checkIn.inspection.pass'),
      failButton: t('checkIn.inspection.fail'),
      passAriaLabel: (label) => t('checkIn.inspection.passAria', { label }),
      failAriaLabel: (label) => t('checkIn.inspection.failAria', { label }),
      noteAriaLabel: (label) => t('checkIn.inspection.noteFor', { label }),
    }),
    [t],
  )

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

  const checkIn = checkInQuery.data
  if (!checkIn?.inspection_id || !inspectionQuery.data) {
    return null
  }

  const readOnly = checkIn.status === 'COMPLETED'

  return (
    <WorkshopTaskInspectionChecklistView
      checklist={inspectionQuery.data}
      labels={checklistLabels}
      readOnly={readOnly}
      touchFriendly
      saving={updateInspection.isPending}
      onSave={async (itemId, values) => {
        const cached = queryClient.getQueryData<WorkshopCheckIn | null>(
          workshopCheckInKeys.record(orderId),
        )
        const revision = cached?.revision ?? checkIn.revision
        try {
          await updateInspection.mutateAsync({
            orderId,
            expectedRevision: revision,
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
