import { useCallback, useLayoutEffect, useRef } from 'react'
import { useLocation, useSearchParams } from 'react-router-dom'

type SearchUpdate = (current: URLSearchParams) => { next: URLSearchParams; replace: boolean }

// Search and layout can flush before the router commits either navigation.
const writtenSearchParams = new WeakMap<ReturnType<typeof useLocation>, URLSearchParams>()

function sortedSearch(params: URLSearchParams): string {
  const sorted = new URLSearchParams(params)
  sorted.sort()
  return sorted.toString()
}

export function useDataTableUrl() {
  const location = useLocation()
  const [searchParams, setSearchParams] = useSearchParams()
  const latest = useRef({ location, searchParams, setSearchParams })
  useLayoutEffect(() => {
    latest.current = { location, searchParams, setSearchParams }
  }, [location, searchParams, setSearchParams])

  const updateSearch = useCallback((update: SearchUpdate) => {
    const latestUrl = latest.current
    const current = writtenSearchParams.get(latestUrl.location) ?? latestUrl.searchParams
    const { next, replace } = update(current)
    if (sortedSearch(next) === sortedSearch(current)) return
    writtenSearchParams.set(latestUrl.location, next)
    latestUrl.setSearchParams(next, { replace })
  }, [])

  return { location, searchParams, updateSearch }
}

export type DataTableUrl = ReturnType<typeof useDataTableUrl>
