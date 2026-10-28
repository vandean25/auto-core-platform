/**
 * Largest page a list asks the API for. The API clamps larger requests anyway (AUT-807), so asking for more only
 * misleads the page count. The vehicle endpoints cap lower than the other lists.
 */
export const MAX_LIST_PAGE_SIZE = 100
export const MAX_VEHICLE_LIST_PAGE_SIZE = 50
/** The page-size choices of the vehicle lists: none above the endpoint's cap. */
export const VEHICLE_LIST_PAGE_SIZE_OPTIONS = [10, 25, 50] as const

export function clampPageSize(pageSize: number, maxPageSize: number = MAX_LIST_PAGE_SIZE): number {
  return Math.min(Math.max(1, Math.trunc(pageSize)), maxPageSize)
}
