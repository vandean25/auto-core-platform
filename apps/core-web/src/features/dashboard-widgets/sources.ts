import type { DashboardWidgetTableSource } from '@/features/dashboard-widgets/types'

const dashboardWidgetSourcesList: DashboardWidgetTableSource[] = [
  {
    sourceKey: 'workshop-orders',
    labelKey: 'dashboard.sources.workshop-orders',
    listPreviewFields: ['order_number', 'customer.last_name', 'status'],
    fields: [
      { key: 'order_number', labelKey: 'dashboard.fields.orderNumber', type: 'categorical' },
      { key: 'customer.last_name', labelKey: 'dashboard.fields.customer', type: 'categorical' },
      { key: 'vehicle.make', labelKey: 'dashboard.fields.vehicleMake', type: 'categorical' },
      { key: 'status', labelKey: 'dashboard.fields.status', type: 'categorical' },
    ],
  },
  {
    sourceKey: 'purchase-bills',
    labelKey: 'dashboard.sources.purchase-bills',
    listPreviewFields: ['vendor_invoice_number', 'vendor.name', 'status'],
    fields: [
      { key: 'vendor_invoice_number', labelKey: 'dashboard.fields.billNumber', type: 'categorical' },
      { key: 'vendor.name', labelKey: 'dashboard.fields.vendor', type: 'categorical' },
      { key: 'status', labelKey: 'dashboard.fields.status', type: 'categorical' },
      { key: 'total_amount', labelKey: 'dashboard.fields.totalAmount', type: 'currency' },
    ],
  },
  {
    sourceKey: 'purchase-orders',
    labelKey: 'dashboard.sources.purchase-orders',
    listPreviewFields: ['order_number', 'vendor.name', 'status'],
    fields: [
      { key: 'order_number', labelKey: 'dashboard.fields.orderNumberShort', type: 'categorical' },
      { key: 'vendor.name', labelKey: 'dashboard.fields.vendor', type: 'categorical' },
      { key: 'status', labelKey: 'dashboard.fields.status', type: 'categorical' },
      { key: 'items.length', labelKey: 'dashboard.fields.items', type: 'number' },
    ],
  },
  {
    sourceKey: 'sales-orders',
    labelKey: 'dashboard.sources.sales-orders',
    listPreviewFields: ['order_number', 'customer.last_name', 'status'],
    fields: [
      { key: 'order_number', labelKey: 'dashboard.fields.orderNumberShort', type: 'categorical' },
      { key: 'customer.last_name', labelKey: 'dashboard.fields.customerLastName', type: 'categorical' },
      { key: 'status', labelKey: 'dashboard.fields.status', type: 'categorical' },
      { key: 'total_amount', labelKey: 'dashboard.fields.totalAmount', type: 'currency' },
    ],
  },
  {
    sourceKey: 'inventory',
    labelKey: 'dashboard.sources.inventory',
    listPreviewFields: ['sku', 'name', 'status'],
    fields: [
      { key: 'sku', labelKey: 'dashboard.fields.partNumber', type: 'categorical' },
      { key: 'name', labelKey: 'dashboard.fields.description', type: 'categorical' },
      { key: 'brand', labelKey: 'dashboard.fields.brand', type: 'categorical' },
      { key: 'status', labelKey: 'dashboard.fields.status', type: 'categorical' },
      { key: 'price', labelKey: 'dashboard.fields.price', type: 'currency' },
    ],
  },
  {
    sourceKey: 'customers',
    labelKey: 'dashboard.sources.customers',
    listPreviewFields: ['last_name', 'email', 'address_city'],
    fields: [
      { key: 'type', labelKey: 'dashboard.fields.type', type: 'categorical' },
      { key: 'last_name', labelKey: 'dashboard.fields.lastName', type: 'categorical' },
      { key: 'email', labelKey: 'dashboard.fields.email', type: 'categorical' },
      { key: 'address_city', labelKey: 'dashboard.fields.city', type: 'categorical' },
    ],
  },
  {
    sourceKey: 'vendors',
    labelKey: 'dashboard.sources.vendors',
    listPreviewFields: ['name', 'email', 'account_number'],
    fields: [
      { key: 'name', labelKey: 'dashboard.fields.name', type: 'categorical' },
      { key: 'email', labelKey: 'dashboard.fields.email', type: 'categorical' },
      { key: 'account_number', labelKey: 'dashboard.fields.accountNumber', type: 'categorical' },
    ],
  },
  {
    sourceKey: 'vehicles',
    labelKey: 'dashboard.sources.vehicles',
    listPreviewFields: ['make', 'model', 'plate'],
    fields: [
      { key: 'make', labelKey: 'dashboard.fields.make', type: 'categorical' },
      { key: 'model', labelKey: 'dashboard.fields.model', type: 'categorical' },
      { key: 'plate', labelKey: 'dashboard.fields.plate', type: 'categorical' },
      { key: 'year', labelKey: 'dashboard.fields.year', type: 'number' },
    ],
  },
  {
    sourceKey: 'pickerl-due',
    labelKey: 'dashboard.sources.pickerl-due',
    listPreviewFields: ['plate', 'vehicle', 'customer', 'status', 'dueMonth'],
    fields: [
      { key: 'plate', labelKey: 'dashboard.fields.plate', type: 'categorical' },
      { key: 'vehicle', labelKey: 'dashboard.fields.vehicle', type: 'categorical' },
      { key: 'customer', labelKey: 'dashboard.fields.customer', type: 'categorical' },
      { key: 'status', labelKey: 'dashboard.fields.status', type: 'categorical' },
      { key: 'dueMonth', labelKey: 'dashboard.fields.dueMonth', type: 'categorical' },
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

