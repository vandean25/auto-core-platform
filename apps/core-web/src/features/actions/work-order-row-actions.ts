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
import type { EntityActionDefinition } from './entity-action'

export type WorkshopOrderListRow = {
  id: string
  orderNo: string
  status: string
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

export function isWorkshopCheckInOpenStatus(status: string | null | undefined): boolean {
  return status === 'INTAKE' || status === 'IN_PROGRESS'
}

export function createWorkshopOrderRowActions(
  t: TFunction<'workshop'>,
): EntityActionDefinition<WorkshopOrderListRow, WorkshopOrderRowActionContext>[] {
  return [
    {
      id: 'open',
      label: t('orders.list.actions.open'),
      icon: ExternalLink,
      shortcutKey: 'o',
      isAllowedForRole: () => true,
      isEnabled: () => true,
      run: (row, { navigate }) => {
        navigate(workshopOrderDetailPath(row.id))
      },
    },
    {
      id: 'checkIn',
      label: t('orders.list.actions.checkIn'),
      icon: LogIn,
      isAllowedForRole: () => true,
      isEnabled: (row) => isWorkshopCheckInOpenStatus(row.status),
      run: (row, { navigate }) => {
        navigate(workshopOrderCheckInPath(row.id))
      },
    },
    {
      id: 'jobCardPdf',
      label: t('orders.list.actions.jobCardPdf'),
      icon: FileDown,
      isAllowedForRole: () => true,
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
