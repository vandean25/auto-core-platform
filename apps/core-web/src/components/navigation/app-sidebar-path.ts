export function normalizePathWithQuery(pathname: string, search: string): string {
  const params = new URLSearchParams(search)
  params.sort()
  const normalizedSearch = params.toString()
  return `${pathname}${normalizedSearch ? `?${normalizedSearch}` : ''}`
}
