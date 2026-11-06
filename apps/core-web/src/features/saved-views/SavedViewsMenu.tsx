import { useState } from 'react'
import { useLocation } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
import { BookmarkCheck, Pencil, Trash2 } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover'
import { executeEntityAction } from '@/features/actions/entity-action'
import { savedViewPath } from '@/features/saved-views/SavedViewsProvider'
import { useSavedViewActions } from '@/features/saved-views/use-saved-view-actions'

/** The saved views of the list that is open: open, rename and remove them. Hidden while the list has none. */
export function SavedViewsMenu({ title }: { title: string }) {
  const { t } = useTranslation('common')
  const location = useLocation()
  const [open, setOpen] = useState(false)
  const { savedViews, actions, context } = useSavedViewActions(() => setOpen(false))

  const views = savedViews.filter((view) => savedViewPath(view.href) === location.pathname)
  if (views.length === 0) return null

  return (
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
                  data-action-id={actions.open.id}
                  className="h-11 min-w-0 flex-1 justify-start md:h-9"
                  onClick={() => executeEntityAction(actions.open, view, context)}
                >
                  <span className="truncate">{view.name}</span>
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  data-action-id={actions.rename.id}
                  className="size-11 shrink-0 md:size-9"
                  aria-label={t('savedViews.renameAria', { name: view.name })}
                  onClick={() => executeEntityAction(actions.rename, view, context)}
                >
                  <Pencil aria-hidden="true" />
                </Button>
                <Button
                  type="button"
                  variant="ghost"
                  data-action-id={actions.remove.id}
                  className="size-11 shrink-0 md:size-9"
                  aria-label={t('savedViews.removeAria', { name: view.name })}
                  onClick={() => executeEntityAction(actions.remove, view, context)}
                >
                  <Trash2 aria-hidden="true" />
                </Button>
              </li>
            ))}
          </ul>
        </PopoverContent>
    </Popover>
  )
}
