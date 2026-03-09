export type DashboardWidgetDisplayType = 'list' | 'donut' | 'metric'
export type DashboardWidgetMetricCalculation = 'count' | 'sum'

export type DashboardWidgetFieldType = 'categorical' | 'number' | 'currency'

export interface DashboardWidgetFieldDefinition {
  key: string
  label: string
  type: DashboardWidgetFieldType
}

export interface DashboardWidgetTableSource {
  sourceKey: string
  sourceLabel: string
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

