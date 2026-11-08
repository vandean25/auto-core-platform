import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { useUpdateWorkshopOrder } from '@/api/workshop'
import type { WorkshopOrder, WorkshopOrderStatus } from '@/api/types'
import { DEFAULT_TIME_ZONE } from '@/lib/i18n/constants'
import { formatLocalDateInZone } from '@/lib/format'
import { getPermissionAwareErrorMessage } from '@/lib/error-utils'
import { shiftScheduleToLocalDate, workshopScheduleDateOptions } from '../workshop-schedule-date'

const RESCHEDULABLE: WorkshopOrderStatus[] = ['SCHEDULED', 'INTAKE']

function instant(value: string | null | undefined) {
  return value ?? null
}

/** Server-confirmed date change: the planner validates bay and mechanic availability. */
export function useWorkshopOrderSchedule(order: WorkshopOrder) {
  const { t } = useTranslation('workshop')
  const updateOrder = useUpdateWorkshopOrder()
  const start = instant(order.scheduledStartAt ?? order.scheduled_start_at)
  const end = instant(order.scheduledEndAt ?? order.scheduled_end_at)
  const bayId = order.bayId ?? order.bay_id ?? null
  const canEdit = RESCHEDULABLE.includes(order.status) && Boolean(bayId && start && end)
  const currentDate = start ? formatLocalDateInZone(new Date(start), DEFAULT_TIME_ZONE) : null
  const options = workshopScheduleDateOptions(new Date(), DEFAULT_TIME_ZONE, currentDate)
  const label = options.find((option) => option.value === currentDate)?.label ?? t('orderHeader.notSet')

  const save = async (date: string) => {
    if (!canEdit || !start || !end || !bayId) return
    const next = shiftScheduleToLocalDate(start, end, date, DEFAULT_TIME_ZONE)
    if (!next) return
    try {
      await updateOrder.mutateAsync({ id: order.id, bayId, ...next })
    } catch (error: unknown) {
      toast.error(getPermissionAwareErrorMessage(error, t('planner.page.rescheduleFailed')))
      throw error
    }
  }

  return {
    label,
    canEdit,
    pending: updateOrder.isPending,
    currentDate,
    options,
    save,
  }
}
