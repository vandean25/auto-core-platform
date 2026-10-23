import { useEffect, useState } from 'react'
import { useQuery } from '@tanstack/react-query'
import { fetchSearch, searchKeys, type SearchGroup } from '@/api/search'
import { isSearchableQuery, parseSearchInput } from '@/components/global-search/global-search-types'

const SEARCH_DEBOUNCE_MS = 300

/**
 * One debounced GET /api/search for the palette input. Stale requests are aborted through the
 * query function's signal. `groups` stays empty while the input is still being debounced.
 */
export function useGlobalSearch(input: string) {
  const trimmed = input.trim()
  const [debounced, setDebounced] = useState(trimmed)

  useEffect(() => {
    const timer = setTimeout(() => setDebounced(trimmed), SEARCH_DEBOUNCE_MS)
    return () => clearTimeout(timer)
  }, [trimmed])

  const { q, types } = parseSearchInput(debounced)
  const enabled = isSearchableQuery(q)
  const isSettled = trimmed === debounced
  const query = useQuery({
    queryKey: searchKeys.results(q, types),
    queryFn: ({ signal }) => fetchSearch(q, types, signal),
    enabled,
    retry: false,
    // The app default keeps data fresh for 5 minutes; search hits change with every create and site switch.
    staleTime: 0,
    gcTime: 0,
  })

  const groups: SearchGroup[] = enabled && isSettled ? (query.data?.groups ?? []) : []
  const wantsSearch = isSearchableQuery(parseSearchInput(trimmed).q)

  return {
    groups,
    isLoading: wantsSearch && (!isSettled || query.isLoading),
    error: enabled && isSettled ? query.error : null,
  }
}
