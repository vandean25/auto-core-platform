import { useCallback, useEffect, useRef } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'

import { PEEK_SEARCH_PARAM } from './peek-search-param'
import { stripPeekSearchParam } from './strip-peek-search-param'

export function usePeekSearchParam() {
  const [searchParams, setSearchParams] = useSearchParams()
  const navigate = useNavigate()
  const peekId = searchParams.get(PEEK_SEARCH_PARAM)
  const peekOpenedViaPushRef = useRef(false)

  useEffect(() => {
    if (!peekId) {
      peekOpenedViaPushRef.current = false
    }
  }, [peekId])

  const openPeek = useCallback(
    (id: string) => {
      peekOpenedViaPushRef.current = true
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          next.set(PEEK_SEARCH_PARAM, id)
          return next
        },
        { replace: false },
      )
    },
    [setSearchParams],
  )

  const closePeek = useCallback(() => {
    if (peekOpenedViaPushRef.current) {
      peekOpenedViaPushRef.current = false
      navigate(-1)
      queueMicrotask(() => stripPeekSearchParam(setSearchParams))
      return
    }
    stripPeekSearchParam(setSearchParams)
  }, [navigate, setSearchParams])

  return {
    peekId,
    isPeekOpen: Boolean(peekId),
    openPeek,
    closePeek,
  }
}
