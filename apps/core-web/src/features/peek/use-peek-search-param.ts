import { useCallback, useEffect, useRef } from 'react'
import { useLocation, useNavigate, useSearchParams } from 'react-router-dom'

import { PEEK_SEARCH_PARAM } from './peek-search-param'
import { stripPeekSearchParam } from './strip-peek-search-param'

export function usePeekSearchParam() {
  const [searchParams, setSearchParams] = useSearchParams()
  const location = useLocation()
  const navigate = useNavigate()
  const peekId = searchParams.get(PEEK_SEARCH_PARAM)
  const peekOpenedViaPushRef = useRef(false)
  const pendingBackStripRef = useRef(false)

  useEffect(() => {
    if (!peekId) {
      peekOpenedViaPushRef.current = false
    }
  }, [peekId])

  useEffect(() => {
    if (!pendingBackStripRef.current) {
      return
    }
    pendingBackStripRef.current = false
    if (searchParams.get(PEEK_SEARCH_PARAM)) {
      stripPeekSearchParam(setSearchParams)
    }
  }, [location.key, searchParams, setSearchParams])

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
      pendingBackStripRef.current = true
      navigate(-1)
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
