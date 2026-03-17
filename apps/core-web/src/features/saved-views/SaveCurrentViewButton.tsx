import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { Star } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
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
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(`${title} View`)

  const href = useMemo(() => `${location.pathname}${location.search}`, [location.pathname, location.search])
  const shouldShow = useMemo(() => hasMeaningfulFilters(location.search), [location.search])

  if (!shouldShow) return null

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    const normalizedName = name.trim()
    if (!normalizedName) return

    const result = addSavedView({ name: normalizedName, href })
    if (result.created) {
      toast.success('Saved view added to Favorites.')
      setOpen(false)
      return
    }
    if (result.reason === 'duplicate') {
      toast.message('This view is already in Favorites.')
      return
    }
    toast.error('Unable to save this view.')
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <DialogTrigger asChild>
        <Button
          variant="outline"
          size="sm"
          className="gap-2"
          aria-label={`Save current ${title.toLowerCase()} view`}
          onClick={() => {
            setName(`${title} View`)
          }}
        >
          <Star className="h-4 w-4" />
          Save View
        </Button>
      </DialogTrigger>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle>Save View</DialogTitle>
            <DialogDescription>
              Give this view a name to save it to your Favorites.
            </DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                Name
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="col-span-3"
                autoFocus
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              Cancel
            </Button>
            <Button type="submit">Save View</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
