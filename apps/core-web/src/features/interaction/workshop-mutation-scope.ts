/** Source files scanned for pilot work-order and mechanic-queue mutation hooks (AUT-894). */
export const WORKSHOP_MUTATION_SOURCE_FILES = [
  'apps/core-web/src/api/workshop.ts',
  'apps/core-web/src/api/workshop-check-in.ts',
  'apps/core-web/src/api/workshop-estimates.ts',
  'apps/core-web/src/api/workshop-measurements.ts',
  'apps/core-web/src/api/workshop-waiting-tasks.ts',
  'apps/core-web/src/api/mechanic.ts',
  'apps/core-web/src/components/workshop/WorkshopReadyEmailNotice.tsx',
] as const

/** Workshop settings/holidays mutations are out of pilot scope (not work-order/mechanic-queue). */
export const WORKSHOP_MUTATION_HOOKS_EXCLUDED_FROM_PILOT = new Set<string>([
  'useUpdateWorkshopSettings',
  'useCreateWorkshopHoliday',
  'useUpdateWorkshopHoliday',
  'useDeleteWorkshopHoliday',
  'useImportWorkshopHolidays',
])
