import { CalendarPlus, ClipboardList, ReceiptText, Truck, Wrench } from 'lucide-react'
import { canCreateAppointment, canCreateWorkshopOrder } from '@/features/actions/action-role-predicates'
import { buildActionDialogHref } from '@/features/actions/use-action-dialog-param'
import { i18n } from '@/lib/i18n'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import type { QuickActionSection } from './global-search-quick-actions'
import { buildWorkshopIntakePrefillHref, type WorkshopIntakePrefill } from './workshop-intake-prefill'

/** Action id the planner page opens its create sheet for (`?action=create`). */
export const PLANNER_CREATE_DIALOG_ACTION_IDS = ['create', 'appointment.create'] as const

/** The create entries of Cmd+K and of the phone "Create" button: one list, gated by role. */
export function getGlobalSearchQuickActionSections(
  intakePrefill?: WorkshopIntakePrefill | null,
  role?: string,
): QuickActionSection[] {
  const createItems = [
    {
      href: buildWorkshopIntakePrefillHref(intakePrefill ?? {}),
      icon: Wrench,
      label: i18n.t('nav:globalSearch.quickActions.createWorkOrder.label'),
      description: i18n.t('nav:globalSearch.quickActions.createWorkOrder.description'),
      isAllowedForRole: canCreateWorkshopOrder,
    },
    {
      href: buildActionDialogHref(APP_ROUTE_PATHS.workshopPlanner, PLANNER_CREATE_DIALOG_ACTION_IDS[0]),
      icon: CalendarPlus,
      label: i18n.t('nav:globalSearch.quickActions.createAppointment.label'),
      description: i18n.t('nav:globalSearch.quickActions.createAppointment.description'),
      isAllowedForRole: canCreateAppointment,
    },
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
  ].filter((item) => item.isAllowedForRole?.(role) ?? true)

  return [
    {
      heading: i18n.t('nav:globalSearch.quickActions.create'),
      items: createItems,
    },
  ]
}
