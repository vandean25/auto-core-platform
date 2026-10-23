import { ClipboardList, ReceiptText, Truck, Wrench } from 'lucide-react'
import { i18n } from '@/lib/i18n'
import type { QuickActionSection } from './global-search-quick-actions'
import { buildWorkshopIntakePrefillHref, type WorkshopIntakePrefill } from './workshop-intake-prefill'

export function getGlobalSearchQuickActionSections(
  intakePrefill?: WorkshopIntakePrefill | null,
): QuickActionSection[] {
  const createItems = [
    ...(intakePrefill?.customerId || intakePrefill?.vehicleId
      ? [
          {
            href: buildWorkshopIntakePrefillHref(intakePrefill),
            icon: Wrench,
            label: i18n.t('nav:globalSearch.quickActions.createWorkOrder.label'),
            description: i18n.t('nav:globalSearch.quickActions.createWorkOrder.description'),
          },
        ]
      : []),
    {
      href: '/sales-orders/new',
      icon: ClipboardList,
      label: i18n.t('nav:globalSearch.quickActions.createSalesOrder.label'),
      description: i18n.t('nav:globalSearch.quickActions.createSalesOrder.description'),
    },
    {
      href: '/purchase-orders/new',
      icon: Truck,
      label: i18n.t('nav:globalSearch.quickActions.createPurchaseOrder.label'),
      description: i18n.t('nav:globalSearch.quickActions.createPurchaseOrder.description'),
    },
    {
      href: '/purchase-bills/new',
      icon: ReceiptText,
      label: i18n.t('nav:globalSearch.quickActions.createPurchaseBill.label'),
      description: i18n.t('nav:globalSearch.quickActions.createPurchaseBill.description'),
    },
  ]

  return [
    {
      heading: i18n.t('nav:globalSearch.quickActions.create'),
      items: createItems,
    },
  ]
}
