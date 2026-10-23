import { useCallback } from 'react'
import { useSearchParams } from 'react-router-dom'

export const ACTION_DIALOG_SEARCH_PARAM = 'action'

export function buildActionDialogHref(
  pathname: string,
  actionId: string,
  search = '',
): string {
  const params = new URLSearchParams(search)
  params.set(ACTION_DIALOG_SEARCH_PARAM, actionId)
  const query = params.toString()
  return query ? `${pathname}?${query}` : pathname
}

export function useActionDialogParam(actionId: string | readonly string[]) {
  const [searchParams, setSearchParams] = useSearchParams()
  const ids = typeof actionId === 'string' ? [actionId] : actionId
  const primaryId = ids[0] ?? ''
  const current = searchParams.get(ACTION_DIALOG_SEARCH_PARAM)
  const open = current !== null && ids.includes(current)

  const onOpenChange = useCallback(
    (nextOpen: boolean) => {
      setSearchParams(
        (prev) => {
          const next = new URLSearchParams(prev)
          if (nextOpen) {
            next.set(ACTION_DIALOG_SEARCH_PARAM, primaryId)
          } else {
            next.delete(ACTION_DIALOG_SEARCH_PARAM)
          }
          return next
        },
        { replace: true },
      )
    },
    [primaryId, setSearchParams],
  )

  return { open, onOpenChange }
}
