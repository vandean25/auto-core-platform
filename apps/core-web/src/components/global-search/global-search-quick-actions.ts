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
import type { LucideIcon } from 'lucide-react'

export type QuickAction = {
  href: string
  icon: LucideIcon
  label: string
  description: string
  /** Extra phrases the palette search matches, such as the action's previous wording. */
  keywords?: string[]
}

export type QuickActionSection = {
  heading: string
  items: QuickAction[]
}

export const quickActionSections: QuickActionSection[] = [
  {
    heading: 'Navigate',
    items: [
      {
        href: '/dashboard',
        icon: LayoutDashboard,
        label: 'Open Dashboard',
        description: 'Review widgets and saved views.',
      },
      {
        href: '/inventory',
        icon: Package,
        label: 'Open Inventory',
        description: 'Browse parts and stock levels.',
      },
      {
        href: '/stock-transfers',
        icon: ArrowLeftRight,
        label: 'Open Transfers',
        description: 'Request and track cross-site stock moves.',
      },
      {
        href: '/sales-orders',
        icon: ReceiptText,
        label: 'Find a sales order to invoice',
        description: 'Open a sales order and use Create Invoice to draft its invoice.',
        keywords: ['create sales invoice', 'sales invoice'],
      },
      {
        href: '/workshop/intake',
        icon: Wrench,
        label: 'Open Workshop Intake',
        description: 'Start a new workshop visit.',
      },
      {
        href: '/settings',
        icon: Settings,
        label: 'Open Settings',
        description: 'Manage finance and master data.',
      },
    ],
  },
  {
    heading: 'Create',
    items: [
      {
        href: '/sales-orders/new',
        icon: ClipboardList,
        label: 'Create Sales Order',
        description: 'Capture a new customer order.',
      },
      {
        href: '/purchase-orders/new',
        icon: Truck,
        label: 'Create Purchase Order',
        description: 'Raise a new supplier order.',
      },
      {
        href: '/purchase-bills/new',
        icon: ReceiptText,
        label: 'Create Purchase Bill',
        description: 'Match a vendor invoice to receipts.',
      },
    ],
  },
]

/**
 * Keeps the actions whose label, description or keywords contain the query, dropping
 * sections that end up empty. An empty query returns every section.
 */
export function filterQuickActionSections(
  sections: QuickActionSection[],
  query: string,
): QuickActionSection[] {
  if (!query) return sections

  const lower = query.toLowerCase()
  return sections
    .map((section) => ({
      ...section,
      items: section.items.filter((item) =>
        [item.label, item.description, ...(item.keywords ?? [])].some((text) =>
          text.toLowerCase().includes(lower),
        ),
      ),
    }))
    .filter((section) => section.items.length > 0)
}
