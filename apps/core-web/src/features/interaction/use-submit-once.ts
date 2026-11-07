import { useCallback, useEffect, useRef } from 'react'

/**
 * Lets a create dialog hand its payload over once per opening, so a double click on Submit cannot create the record
 * twice before the dialog has closed. `claim()` is true for the first call and false afterwards, until the dialog reopens.
 */
export function useSubmitOnce(isOpen: boolean) {
  const claimed = useRef(false)
  useEffect(() => {
    if (isOpen) claimed.current = false
  }, [isOpen])
  return useCallback(() => {
    if (claimed.current) return false
    claimed.current = true
    return true
  }, [])
}
