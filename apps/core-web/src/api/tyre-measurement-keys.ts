export const tyreMeasurementKeys = {
  all: ['tyre-measurements'] as const,
  list: (parent: { kind: 'order' | 'check-in'; id: string }, siteId: string | null = null) =>
    [...tyreMeasurementKeys.all, 'list', parent.kind, parent.id, siteId] as const,
}
