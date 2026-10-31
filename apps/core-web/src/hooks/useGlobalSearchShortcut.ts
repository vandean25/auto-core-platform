import { useEffect, useState } from 'react'

export function useGlobalSearchShortcut() {
  const [searchOpen, setSearchOpen] = useState(false)

  useEffect(() => {
    const down = (event: KeyboardEvent) => {
      if (event.key === 'k' && (event.metaKey || event.ctrlKey)) {
        event.preventDefault()
        setSearchOpen((open) => !open)
      }
    }
    document.addEventListener('keydown', down)
    return () => document.removeEventListener('keydown', down)
  }, [])

  return [searchOpen, setSearchOpen] as const
}
