import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
import { TooltipHint } from '@/components/ui/tooltip'
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
  const { t } = useTranslation('common')
  const location = useLocation()
  const { addSavedView } = useSavedViews()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(() => t('savedViews.defaultName', { title }))

  const href = useMemo(() => `${location.pathname}${location.search}`, [location.pathname, location.search])
  const shouldShow = useMemo(() => hasMeaningfulFilters(location.search), [location.search])

  if (!shouldShow) return null

  const handleSave = (e: React.FormEvent) => {
    e.preventDefault()
    const normalizedName = name.trim()
    if (!normalizedName) return

    const result = addSavedView({ name: normalizedName, href })
    if (result.created) {
      toast.success(t('savedViews.added'))
      setOpen(false)
      return
    }
    if (result.reason === 'duplicate') {
      toast.message(t('savedViews.duplicate'))
      return
    }
    toast.error(t('savedViews.failed'))
  }

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <TooltipHint hint={t('savedViews.saveHint')}>
        <DialogTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 max-md:h-11"
            aria-label={t('savedViews.saveAria', { title })}
            onClick={() => {
              setName(t('savedViews.defaultName', { title }))
            }}
          >
            <Star className="h-4 w-4" />
            {t('savedViews.saveButton')}
          </Button>
        </DialogTrigger>
      </TooltipHint>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle>{t('savedViews.title')}</DialogTitle>
            <DialogDescription>{t('savedViews.description')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-4 py-4">
            <div className="grid grid-cols-4 items-center gap-4">
              <Label htmlFor="name" className="text-right">
                {t('savedViews.nameLabel')}
              </Label>
              <Input
                id="name"
                value={name}
                onChange={(e) => setName(e.target.value)}
                className="col-span-3"
              />
            </div>
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={() => setOpen(false)}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit">{t('actions.save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
