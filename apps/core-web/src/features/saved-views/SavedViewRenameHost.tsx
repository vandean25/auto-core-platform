import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useSavedViews, type SavedView } from '@/features/saved-views/SavedViewsProvider'

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
      {/* No description: the title and the name field say all there is to do. */}
      <DialogContent className="sm:max-w-[425px]" aria-describedby={undefined}>
        <form onSubmit={handleSubmit}>
          <DialogHeader>
            <DialogTitle>{t('savedViews.renameTitle')}</DialogTitle>
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

/** The one rename dialog of the app shell, opened from the toolbar menu and from Cmd+K. */
export function SavedViewRenameHost() {
  const { renamingView, cancelRename } = useSavedViews()
  return renamingView ? <RenameViewDialog key={renamingView.id} view={renamingView} onClose={cancelRename} /> : null
}
