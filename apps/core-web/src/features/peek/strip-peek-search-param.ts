import type { SetURLSearchParams } from 'react-router-dom'

import { PEEK_SEARCH_PARAM } from './peek-search-param'

export function stripPeekSearchParam(setSearchParams: SetURLSearchParams) {
  setSearchParams(
    (prev) => {
      if (!prev.get(PEEK_SEARCH_PARAM)) {
        return prev
      }
      const next = new URLSearchParams(prev)
      next.delete(PEEK_SEARCH_PARAM)
      return next
    },
    { replace: true },
  )
}
