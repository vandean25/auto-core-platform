import type { DashboardWidgetTableSource } from '@/features/dashboard-widgets/types'

const dashboardWidgetSourcesList: DashboardWidgetTableSource[] = [
  {
    sourceKey: 'workshop-orders',
    sourceLabel: 'Workshop Orders',
    listPreviewFields: ['order_number', 'customer.last_name', 'status'],
    fields: [
      { key: 'order_number', label: 'Order No.', type: 'categorical' },
      { key: 'customer.last_name', label: 'Customer', type: 'categorical' },
      { key: 'vehicle.make', label: 'Vehicle Make', type: 'categorical' },
      { key: 'status', label: 'Status', type: 'categorical' },
    ],
  },
  {
    sourceKey: 'purchase-bills',
    sourceLabel: 'Purchase Bills',
    listPreviewFields: ['vendor_invoice_number', 'vendor.name', 'status'],
    fields: [
      { key: 'vendor_invoice_number', label: 'Bill #', type: 'categorical' },
      { key: 'vendor.name', label: 'Vendor', type: 'categorical' },
      { key: 'status', label: 'Status', type: 'categorical' },
      { key: 'total_amount', label: 'Total Amount', type: 'currency' },
    ],
  },
  {
    sourceKey: 'purchase-orders',
    sourceLabel: 'Purchase Orders',
    listPreviewFields: ['order_number', 'vendor.name', 'status'],
    fields: [
      { key: 'order_number', label: 'Order #', type: 'categorical' },
      { key: 'vendor.name', label: 'Vendor', type: 'categorical' },
      { key: 'status', label: 'Status', type: 'categorical' },
      { key: 'items.length', label: 'Items', type: 'number' },
    ],
  },
  {
    sourceKey: 'sales-orders',
    sourceLabel: 'Sales Orders',
    listPreviewFields: ['order_number', 'customer.last_name', 'status'],
    fields: [
      { key: 'order_number', label: 'Order #', type: 'categorical' },
      { key: 'customer.last_name', label: 'Customer Last Name', type: 'categorical' },
      { key: 'status', label: 'Status', type: 'categorical' },
      { key: 'total_amount', label: 'Total Amount', type: 'currency' },
    ],
  },
  {
    sourceKey: 'inventory',
    sourceLabel: 'Inventory',
    listPreviewFields: ['sku', 'name', 'status'],
    fields: [
      { key: 'sku', label: 'Part Number', type: 'categorical' },
      { key: 'name', label: 'Description', type: 'categorical' },
      { key: 'brand', label: 'Brand', type: 'categorical' },
      { key: 'status', label: 'Status', type: 'categorical' },
      { key: 'price', label: 'Price', type: 'currency' },
    ],
  },
  {
    sourceKey: 'customers',
    sourceLabel: 'Customers',
    listPreviewFields: ['last_name', 'email', 'address_city'],
    fields: [
      { key: 'type', label: 'Type', type: 'categorical' },
      { key: 'last_name', label: 'Last Name', type: 'categorical' },
      { key: 'email', label: 'Email', type: 'categorical' },
      { key: 'address_city', label: 'City', type: 'categorical' },
    ],
  },
  {
    sourceKey: 'vendors',
    sourceLabel: 'Vendors',
    listPreviewFields: ['name', 'email', 'account_number'],
    fields: [
      { key: 'name', label: 'Name', type: 'categorical' },
      { key: 'email', label: 'Email', type: 'categorical' },
      { key: 'account_number', label: 'Account #', type: 'categorical' },
    ],
  },
  {
    sourceKey: 'vehicles',
    sourceLabel: 'Vehicles',
    listPreviewFields: ['make', 'model', 'plate'],
    fields: [
      { key: 'make', label: 'Make', type: 'categorical' },
      { key: 'model', label: 'Model', type: 'categorical' },
      { key: 'plate', label: 'Plate', type: 'categorical' },
      { key: 'year', label: 'Year', type: 'number' },
    ],
  },
]

export const dashboardWidgetSourcesByKey: Record<string, DashboardWidgetTableSource> = dashboardWidgetSourcesList.reduce(
  (accumulator, source) => {
    accumulator[source.sourceKey] = source
    return accumulator
  },
  {} as Record<string, DashboardWidgetTableSource>,
)

export function getDashboardWidgetSource<K extends keyof typeof dashboardWidgetSourcesByKey | string>(
  key: K,
): DashboardWidgetTableSource {
  const source = dashboardWidgetSourcesByKey[key]
  if (!source) {
    throw new Error(`Dashboard widget source with key "${key}" not found.`)
  }
  return source
}

export const DASHBOARD_WIDGET_SOURCE_WORKSHOP_ORDERS = getDashboardWidgetSource('workshop-orders')
export const DASHBOARD_WIDGET_SOURCE_PURCHASE_BILLS = getDashboardWidgetSource('purchase-bills')
export const DASHBOARD_WIDGET_SOURCE_PURCHASE_ORDERS = getDashboardWidgetSource('purchase-orders')
export const DASHBOARD_WIDGET_SOURCE_SALES_ORDERS = getDashboardWidgetSource('sales-orders')
export const DASHBOARD_WIDGET_SOURCE_INVENTORY = getDashboardWidgetSource('inventory')
export const DASHBOARD_WIDGET_SOURCE_CUSTOMERS = getDashboardWidgetSource('customers')
export const DASHBOARD_WIDGET_SOURCE_VENDORS = getDashboardWidgetSource('vendors')
export const DASHBOARD_WIDGET_SOURCE_VEHICLES = getDashboardWidgetSource('vehicles')

