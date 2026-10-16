import {
  ArrowLeftRight,
  ClipboardList,
  LayoutDashboard,
  Package,
  ReceiptText,
  Settings,
  Truck,
  Wrench,
} from 'lucide-react'
import { i18n } from '@/lib/i18n'
import type { QuickActionSection } from './global-search-quick-actions'

export function getGlobalSearchQuickActionSections(): QuickActionSection[] {
  return [
    {
      heading: i18n.t('nav:globalSearch.quickActions.navigate'),
      items: [
        {
          href: '/dashboard',
          icon: LayoutDashboard,
          label: i18n.t('nav:globalSearch.quickActions.openDashboard.label'),
          description: i18n.t('nav:globalSearch.quickActions.openDashboard.description'),
        },
        {
          href: '/inventory',
          icon: Package,
          label: i18n.t('nav:globalSearch.quickActions.openInventory.label'),
          description: i18n.t('nav:globalSearch.quickActions.openInventory.description'),
        },
        {
          href: '/stock-transfers',
          icon: ArrowLeftRight,
          label: i18n.t('nav:globalSearch.quickActions.openTransfers.label'),
          description: i18n.t('nav:globalSearch.quickActions.openTransfers.description'),
        },
        {
          href: '/sales-orders',
          icon: ReceiptText,
          label: i18n.t('nav:globalSearch.quickActions.findSalesOrderToInvoice.label'),
          description: i18n.t('nav:globalSearch.quickActions.findSalesOrderToInvoice.description'),
          keywords: i18n
            .t('nav:globalSearch.quickActions.findSalesOrderToInvoice.keywords')
            .split(','),
        },
        {
          href: '/workshop/intake',
          icon: Wrench,
          label: i18n.t('nav:globalSearch.quickActions.openWorkshopIntake.label'),
          description: i18n.t('nav:globalSearch.quickActions.openWorkshopIntake.description'),
        },
        {
          href: '/settings',
          icon: Settings,
          label: i18n.t('nav:globalSearch.quickActions.openSettings.label'),
          description: i18n.t('nav:globalSearch.quickActions.openSettings.description'),
        },
      ],
    },
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
