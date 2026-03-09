import { useMemo } from 'react'
import { useLocation } from 'react-router-dom'
import { Star } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { useSavedViews } from '@/features/saved-views/SavedViewsProvider'

const TABLE_STATE_KEYS = new Set(['page', 'pageSize', 'sortField', 'sortDirection'])

function hasMeaningfulFilters(search: string): boolean {
  const searchParams = new URLSearchParams(search)
  for (const [key] of searchParams.entries()) {
    if (key === 'search') return true
    if (key.startsWith('filter_')) return true
    if (!TABLE_STATE_KEYS.has(key)) return true
  }
  return false
}

type SaveCurrentViewButtonProps = {
  title: string
}

export function SaveCurrentViewButton({ title }: SaveCurrentViewButtonProps) {
  const location = useLocation()
  const { addSavedView } = useSavedViews()

  const href = useMemo(() => `${location.pathname}${location.search}`, [location.pathname, location.search])
  const shouldShow = useMemo(() => hasMeaningfulFilters(location.search), [location.search])

  if (!shouldShow) return null

  return (
    <Button
      variant="outline"
      size="sm"
      onClick={() => {
        const defaultName = `${title} View`
        const name = window.prompt('Name this saved view', defaultName)
        const normalizedName = name?.trim()
        if (!normalizedName) return

        const result = addSavedView({ name: normalizedName, href })
        if (result.created) {
          toast.success('Saved view added to Favorites.')
          return
        }
        if (result.reason === 'duplicate') {
          toast.message('This view is already in Favorites.')
          return
        }
        toast.error('Unable to save this view.')
      }}
      className="gap-2"
      aria-label={`Save current ${title.toLowerCase()} view`}
    >
      <Star className="h-4 w-4" />
      Save View
    </Button>
  )
}

