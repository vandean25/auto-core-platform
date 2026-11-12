import { formatLocalDate } from './planner-time'

const DATE_PARAM_PATTERN = /^\d{4}-\d{2}-\d{2}$/

export function isPlannerDateSearchParam(value: string | null): value is string {
  return !!value && DATE_PARAM_PATTERN.test(value)
}

export function initialPlannerAnchorDate(
  dateParam: string | null,
  timezone: string,
): string {
  if (isPlannerDateSearchParam(dateParam)) {
    return dateParam
  }
  return formatLocalDate(new Date(), timezone)
}
