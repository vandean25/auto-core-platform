export const dashboardWidgetKeys = {
  all: ['dashboard-widget-data'] as const,
  source: (sourceKey: string) => [...dashboardWidgetKeys.all, sourceKey] as const,
  /** Keyed by the API URL that is fetched, so widgets that need the same URL share one request. */
  rows: (sourceKey: string, apiUrl: string) => [...dashboardWidgetKeys.source(sourceKey), apiUrl] as const,
}
