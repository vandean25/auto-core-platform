import { useMemo, useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { Bookmark } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
  DialogTrigger,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { TooltipHint } from '@/components/ui/tooltip'
import { useSavedViews } from '@/features/saved-views/SavedViewsProvider'

type SaveCurrentViewButtonProps = {
  title: string
}

export function SaveCurrentViewButton({ title }: SaveCurrentViewButtonProps) {
  const { t } = useTranslation('common')
  const location = useLocation()
  const { addSavedView, isOfflineError } = useSavedViews()
  const [open, setOpen] = useState(false)
  const [name, setName] = useState(() => t('savedViews.defaultName', { title }))

  const href = useMemo(() => `${location.pathname}${location.search}`, [location.pathname, location.search])

  const handleSave = async (e: React.FormEvent) => {
    e.preventDefault()
    const normalizedName = name.trim()
    if (!normalizedName) return

    const result = await addSavedView({ name: normalizedName, href })
    if (result.created) {
      toast.success(t('savedViews.added'))
      setOpen(false)
      return
    }
    if (result.reason === 'duplicate') {
      toast.message(t('savedViews.duplicate'))
      return
    }
    if (result.reason === 'limit') {
      toast.error(t('savedViews.limitReached'))
      return
    }
    toast.error(t('savedViews.failed'))
  }

  return (
    <div className="flex items-center gap-2">
      {isOfflineError ? (
        <span role="status" className="sr-only">
          {t('savedViews.offlineError')}
        </span>
      ) : null}
      <Dialog open={open} onOpenChange={setOpen}>
        <TooltipHint hint={isOfflineError ? t('savedViews.offlineError') : t('savedViews.saveHint')}>
          <DialogTrigger asChild>
            <Button
              variant="outline"
              size="sm"
              disabled={isOfflineError}
              className="gap-2 max-md:size-11 max-md:px-0"
              aria-label={t('savedViews.saveAria', { title })}
              onClick={() => {
                setName(t('savedViews.defaultName', { title }))
              }}
            >
              <Bookmark className="h-4 w-4" />
              <span className="max-md:sr-only">{t('savedViews.saveButton')}</span>
            </Button>
          </DialogTrigger>
        </TooltipHint>
      <DialogContent className="sm:max-w-[425px]" aria-describedby={undefined}>
        <form onSubmit={handleSave}>
          <DialogHeader>
            <DialogTitle>{t('savedViews.title')}</DialogTitle>
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
    </div>
  )
}
