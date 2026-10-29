export const tyreMeasurementKeys = {
  all: ['tyre-measurements'] as const,
  list: (parent: { kind: 'order' | 'check-in'; id: string }) =>
    [...tyreMeasurementKeys.all, 'list', parent.kind, parent.id] as const,
}
