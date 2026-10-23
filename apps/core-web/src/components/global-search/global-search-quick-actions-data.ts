import { ClipboardList, ReceiptText, Truck } from 'lucide-react'
import { i18n } from '@/lib/i18n'
import type { QuickActionSection } from './global-search-quick-actions'

export function getGlobalSearchQuickActionSections(): QuickActionSection[] {
  return [
    {
      heading: i18n.t('nav:globalSearch.quickActions.create'),
      items: [
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
      ],
    },
  ]
}
