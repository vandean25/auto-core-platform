export type DashboardSourceLabelKey =
  | 'dashboard.sources.customers'
  | 'dashboard.sources.inventory'
  | 'dashboard.sources.pickerl-due'
  | 'dashboard.sources.purchase-bills'
  | 'dashboard.sources.purchase-orders'
  | 'dashboard.sources.sales-orders'
  | 'dashboard.sources.vehicles'
  | 'dashboard.sources.vendors'
  | 'dashboard.sources.workshop-orders'

export type DashboardFieldLabelKey =
  | 'dashboard.fields.accountNumber'
  | 'dashboard.fields.billNumber'
  | 'dashboard.fields.brand'
  | 'dashboard.fields.city'
  | 'dashboard.fields.customer'
  | 'dashboard.fields.customerLastName'
  | 'dashboard.fields.description'
  | 'dashboard.fields.dueMonth'
  | 'dashboard.fields.email'
  | 'dashboard.fields.items'
  | 'dashboard.fields.lastName'
  | 'dashboard.fields.make'
  | 'dashboard.fields.model'
  | 'dashboard.fields.name'
  | 'dashboard.fields.orderNumber'
  | 'dashboard.fields.orderNumberShort'
  | 'dashboard.fields.partNumber'
  | 'dashboard.fields.plate'
  | 'dashboard.fields.price'
  | 'dashboard.fields.status'
  | 'dashboard.fields.totalAmount'
  | 'dashboard.fields.type'
  | 'dashboard.fields.vehicle'
  | 'dashboard.fields.vehicleMake'
  | 'dashboard.fields.vendor'
  | 'dashboard.fields.year'

export type DashboardWidgetDisplayType = 'list' | 'donut' | 'metric'
export type DashboardWidgetMetricCalculation = 'count' | 'sum'

export type DashboardWidgetFieldType = 'categorical' | 'number' | 'currency'

export interface DashboardWidgetFieldDefinition {
  key: string
  labelKey: DashboardFieldLabelKey
  type: DashboardWidgetFieldType
}

export interface DashboardWidgetTableSource {
  sourceKey: string
  labelKey: DashboardSourceLabelKey
  fields: DashboardWidgetFieldDefinition[]
  listPreviewFields: string[]
}

export interface DashboardWidget {
  id: string
  name: string
  sourceKey: string
  sourceLabel: string
  href: string
  displayType: DashboardWidgetDisplayType
  groupByField?: string
  metricCalculation?: DashboardWidgetMetricCalculation
  metricField?: string
  createdAt: string
}

