import type { TFunction } from 'i18next'
import type { NavigateFunction } from 'react-router-dom'
import { FileDown, LogIn, ExternalLink } from 'lucide-react'

import {
  downloadWorkshopPdf,
  type useGenerateWorkshopPdf,
} from '@/api/workshop'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { triggerBlobDownload } from '@/lib/download'
import { toast } from 'sonner'
import type { WorkshopOrder } from '@/api/types'
import {
  canCheckInWorkshopOrder,
  canGenerateWorkshopJobCardPdf,
  canOpenWorkshopOrder,
  isWorkshopCheckInOpenStatus,
} from './action-role-predicates'
import { ENTITY_ACTION_IDS, type EntityActionDefinition } from './entity-action'

export type WorkshopOrderListRow = {
  id: string
  orderNo: string
  customer: string
  vehicle: string
  openedAt: string
  status: WorkshopOrder['status']
}

export type WorkshopOrderRowActionContext = {
  navigate: NavigateFunction
  generatePdf: ReturnType<typeof useGenerateWorkshopPdf>
  t: TFunction<'workshop'>
}

function workshopOrderDetailPath(orderId: string) {
  return APP_ROUTE_PATHS.workshopOrderDetail.replace(':id', orderId)
}

function workshopOrderCheckInPath(orderId: string) {
  return APP_ROUTE_PATHS.workshopOrderCheckIn.replace(':id', orderId)
}

export function createWorkshopOrderRowActions(
  t: TFunction<'workshop'>,
): EntityActionDefinition<WorkshopOrderListRow, WorkshopOrderRowActionContext>[] {
  return [
    {
      id: ENTITY_ACTION_IDS.workOrderOpen,
      kind: 'navigate',
      label: t('orders.list.actions.open'),
      icon: ExternalLink,
      shortcutKey: 'o',
      isAllowedForRole: canOpenWorkshopOrder,
      isEnabled: () => true,
      run: (row, { navigate }) => {
        navigate(workshopOrderDetailPath(row.id))
      },
    },
    {
      id: ENTITY_ACTION_IDS.workOrderCheckIn,
      kind: 'navigate',
      label: t('orders.list.actions.checkIn'),
      icon: LogIn,
      isAllowedForRole: canCheckInWorkshopOrder,
      isEnabled: (row) => isWorkshopCheckInOpenStatus(row.status),
      run: (row, { navigate }) => {
        navigate(workshopOrderCheckInPath(row.id))
      },
    },
    {
      id: ENTITY_ACTION_IDS.workOrderJobCardPdf,
      kind: 'run',
      label: t('orders.list.actions.jobCardPdf'),
      icon: FileDown,
      isAllowedForRole: canGenerateWorkshopJobCardPdf,
      isEnabled: () => true,
      run: async (row, { generatePdf, t: translate }) => {
        const toastId = toast.loading(translate('orderDetail.toast.jobCardPdfGenerating'))
        try {
          const res = await generatePdf.mutateAsync(row.id)
          if (res.enqueued) {
            toast.success(translate('orderDetail.toast.jobCardPdfQueued'), { id: toastId })
            return
          }
          const blob = await downloadWorkshopPdf(row.id)
          const fileName = `job-card-${row.orderNo}`
            .replace(/[^a-z0-9]/gi, '_')
            .toLowerCase()
          triggerBlobDownload(blob, `${fileName}.pdf`)
          toast.success(translate('orderDetail.toast.jobCardPdfDownloaded'), { id: toastId })
        } catch {
          toast.error(translate('orderDetail.toast.jobCardPdfFailed'), { id: toastId })
        }
      },
    },
  ]
}
