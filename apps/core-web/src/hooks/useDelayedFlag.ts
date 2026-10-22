import { useEffect, useState } from 'react'

/** True once `flag` has stayed true for `delayMs`, so a fast response never flashes a skeleton. */
export function useDelayedFlag(flag: boolean, delayMs = 200): boolean {
  const [elapsed, setElapsed] = useState(false)

  useEffect(() => {
    if (!flag) return
    const timer = setTimeout(() => setElapsed(true), delayMs)
    return () => {
      clearTimeout(timer)
      setElapsed(false)
    }
  }, [flag, delayMs])

  return flag && elapsed
}
