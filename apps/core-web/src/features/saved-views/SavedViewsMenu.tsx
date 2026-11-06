import { useMemo, useState } from 'react'
import { useLocation, useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookmarkCheck, Pencil, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { executeEntityAction } from '@/features/actions/entity-action'
import { createSavedViewActions, type SavedViewActionContext } from '@/features/actions/saved-view-actions'
import { savedViewPath, useSavedViews, type SavedView } from '@/features/saved-views/SavedViewsProvider'

function RenameViewDialog({ view, onClose }: { view: SavedView; onClose: () => void }) {
  const { t } = useTranslation('common')
  const { renameSavedView } = useSavedViews()
  const [name, setName] = useState(view.name)
  const [error, setError] = useState<string | null>(null)

  const handleSubmit = (event: React.FormEvent) => {
    event.preventDefault()
    const result = renameSavedView(view.id, name)
    if (result.ok) {
      toast.success(t('savedViews.renamed'))
      onClose()
      return
    }
    setError(result.reason === 'duplicate' ? t('savedViews.renameDuplicate') : t('savedViews.renameFailed'))
  }

  return (
    <Dialog open onOpenChange={(open) => !open && onClose()}>
      <DialogContent className="sm:max-w-[425px]">
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('savedViews.renameTitle')}</DialogTitle>
            <DialogDescription>{t('savedViews.renameDescription')}</DialogDescription>
          </DialogHeader>
          <div className="grid gap-2 py-4">
            <Label htmlFor="saved-view-rename">{t('savedViews.nameLabel')}</Label>
            <Input
              id="saved-view-rename"
              value={name}
              className="h-11 md:h-9"
              aria-invalid={error ? true : undefined}
              onChange={(event) => {
                setName(event.target.value)
                setError(null)
              }}
            />
            {error ? (
              <p role="alert" className="text-sm text-destructive">
                {error}
              </p>
            ) : null}
          </div>
          <DialogFooter>
            <Button type="button" variant="outline" onClick={onClose}>
              {t('actions.cancel')}
            </Button>
            <Button type="submit">{t('actions.save')}</Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}

/** The saved views of the list that is open: open, rename and remove them. Hidden while the list has none. */
export function SavedViewsMenu({ title }: { title: string }) {
  const { t } = useTranslation('common')
  const location = useLocation()
  const navigate = useNavigate()
  const { savedViews, removeSavedView } = useSavedViews()
  const [open, setOpen] = useState(false)
  const [renaming, setRenaming] = useState<SavedView | null>(null)
  const [openAction, renameAction, deleteAction] = useMemo(() => createSavedViewActions(t), [t])
  const context: SavedViewActionContext = {
    open: (view) => {
      setOpen(false)
      navigate(view.href)
    },
    rename: (view) => {
      setOpen(false)
      setRenaming(view)
    },
    remove: (view) => {
      removeSavedView(view.id)
      toast.message(t('savedViews.removed'))
    },
  }

  const views = savedViews.filter((view) => savedViewPath(view.href) === location.pathname)
  if (views.length === 0) return null

  return (
    <>
      <Popover open={open} onOpenChange={setOpen}>
        <PopoverTrigger asChild>
          <Button
            variant="outline"
            size="sm"
            className="gap-2 max-md:size-11 max-md:px-0"
            aria-label={t('savedViews.menuAria', { title })}
          >
            <BookmarkCheck className="h-4 w-4" />
            <span className="max-md:sr-only">{t('savedViews.menuButton')}</span>
          </Button>
        </PopoverTrigger>
        <PopoverContent
          align="end"
          aria-label={t('savedViews.menuTitle')}
          className="w-[min(20rem,calc(100vw-2rem))] p-1"
        >
          <ul className="flex flex-col">
            {views.map((view) => (
              <li key={view.id} className="flex items-center gap-1">
                <Button
                  type="button"
                  variant="ghost"
                  data-action-id={openAction.id}
                  className="h-11 min-w-0 flex-1 justify-start md:h-9"
                  onClick={() => executeEntityAction(openAction, view, context)}
                >
                  <span className="truncate">{view.name}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  data-action-id={renameAction.id}
                  className="size-11 shrink-0 md:size-9"
                  aria-label={t('savedViews.renameAria', { name: view.name })}
                  onClick={() => executeEntityAction(renameAction, view, context)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  data-action-id={deleteAction.id}
                  className="size-11 shrink-0 md:size-9"
                  aria-label={t('savedViews.removeAria', { name: view.name })}
                  onClick={() => executeEntityAction(deleteAction, view, context)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </PopoverContent>
      </Popover>
      {renaming ? <RenameViewDialog view={renaming} onClose={() => setRenaming(null)} /> : null}
    </>
  )
}
