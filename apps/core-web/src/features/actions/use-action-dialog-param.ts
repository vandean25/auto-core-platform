import { useCallback, useEffect } from 'react'
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

/** One-shot variant for pages that keep their own open state: `?action=<id>` calls `onOpen`, then leaves the URL. */
export function useActionParamOpen(actionId: string | readonly string[], onOpen: () => void) {
  const [searchParams, setSearchParams] = useSearchParams()
  const current = searchParams.get(ACTION_DIALOG_SEARCH_PARAM)
  const matches = current !== null && (typeof actionId === 'string' ? [actionId] : actionId).includes(current)

  useEffect(() => {
    if (!matches) return
    onOpen()
    setSearchParams(
      (prev) => {
        const next = new URLSearchParams(prev)
        next.delete(ACTION_DIALOG_SEARCH_PARAM)
        return next
      },
      { replace: true },
    )
  }, [matches, onOpen, setSearchParams])
}
