import * as React from 'react'
import { Loader2, Star, Trash2 } from 'lucide-react'
import { useTranslation } from 'react-i18next'
import { toast } from 'sonner'

import {
  useCreateImportSource,
  useDeleteImportSource,
  useImportSources,
  useUpdateImportSource,
} from '@/api/imports'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from '@/components/ui/alert-dialog'
import { Checkbox } from '@/components/ui/checkbox'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'

type SourceForm = {
  key: string
  label: string
  isDefault: boolean
}

const EMPTY_FORM: SourceForm = { key: '', label: '', isDefault: false }

/** Admin section: manage the tenant's import source keys. */
export function ImportSourcesPanel() {
  const { t } = useTranslation(['settings', 'common'])
  const { data } = useImportSources()
  const sources = data?.data ?? []
  const createSource = useCreateImportSource()
  const updateSource = useUpdateImportSource()
  const deleteSource = useDeleteImportSource()

  const [form, setForm] = React.useState<SourceForm>(EMPTY_FORM)
  const [pendingDeleteId, setPendingDeleteId] = React.useState<string | null>(null)
  const pendingDelete = sources.find((source) => source.id === pendingDeleteId) ?? null

  function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    if (!form.key.trim() || !form.label.trim()) {
      toast.error(t('dataImport.sources.toastFieldsRequired'))
      return
    }
    createSource.mutate(
      { key: form.key, label: form.label, is_default: form.isDefault },
      {
        onSuccess: () => {
          setForm(EMPTY_FORM)
          toast.success(t('dataImport.sources.toastCreated'))
        },
        onError: () => toast.error(t('dataImport.sources.toastCreateFailed')),
      },
    )
  }

  function handleSetDefault(id: string) {
    updateSource.mutate(
      { id, payload: { is_default: true } },
      {
        onSuccess: () => toast.success(t('dataImport.sources.toastDefaultSet')),
        onError: () => toast.error(t('dataImport.sources.toastDefaultFailed')),
      },
    )
  }

  function handleDelete() {
    if (!pendingDeleteId) return
    deleteSource.mutate(pendingDeleteId, {
      onSuccess: () => {
        setPendingDeleteId(null)
        toast.success(t('dataImport.sources.toastDeleted'))
      },
      onError: () => toast.error(t('dataImport.sources.toastDeleteFailed')),
    })
  }

  return (
    <section className="space-y-4" aria-labelledby="import-sources-heading">
      <div>
        <h3 id="import-sources-heading" className="text-base font-medium">
          {t('dataImport.sources.title')}
        </h3>
        <p className="text-sm text-muted-foreground max-w-2xl">
          {t('dataImport.sources.description')}
        </p>
      </div>

      <form onSubmit={handleCreate} className="grid gap-3 md:grid-cols-[1fr_1fr_auto] md:items-end">
        <div className="space-y-2">
          <Label htmlFor="import-source-key">{t('dataImport.sources.keyLabel')}</Label>
          <Input
            id="import-source-key"
            value={form.key}
            placeholder={t('dataImport.sources.keyPlaceholder')}
            onChange={(event) => setForm((prev) => ({ ...prev, key: event.target.value }))}
          />
        </div>
        <div className="space-y-2">
          <Label htmlFor="import-source-label">{t('dataImport.sources.labelLabel')}</Label>
          <Input
            id="import-source-label"
            value={form.label}
            placeholder={t('dataImport.sources.labelPlaceholder')}
            onChange={(event) => setForm((prev) => ({ ...prev, label: event.target.value }))}
          />
        </div>
        <div className="flex flex-wrap items-center gap-3 md:pb-2">
          <div className="flex items-center gap-2">
            <Checkbox
              id="import-source-default"
              checked={form.isDefault}
              onCheckedChange={(checked) =>
                setForm((prev) => ({ ...prev, isDefault: checked === true }))
              }
            />
            <Label htmlFor="import-source-default">{t('dataImport.sources.defaultLabel')}</Label>
          </div>
          <Button type="submit" disabled={createSource.isPending}>
            {createSource.isPending ? <Loader2 className="mr-2 h-4 w-4 animate-spin" /> : null}
            {t('dataImport.sources.add')}
          </Button>
        </div>
        <p className="text-xs text-muted-foreground md:col-span-3">
          {t('dataImport.sources.keyHint')}
        </p>
      </form>

      <div className="rounded-md border">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>{t('dataImport.sources.columnLabel')}</TableHead>
              <TableHead>{t('dataImport.sources.columnKey')}</TableHead>
              <TableHead>{t('dataImport.sources.columnDefault')}</TableHead>
              <TableHead className="text-right" />
            </TableRow>
          </TableHeader>
          <TableBody>
            {sources.length === 0 ? (
              <TableRow>
                <TableCell colSpan={4} className="text-sm text-muted-foreground">
                  {t('dataImport.sources.empty')}
                </TableCell>
              </TableRow>
            ) : (
              sources.map((source) => (
                <TableRow key={source.id}>
                  <TableCell>{source.label}</TableCell>
                  <TableCell className="font-mono text-sm">{source.key}</TableCell>
                  <TableCell>
                    {source.is_default ? (
                      <Badge variant="secondary">{t('dataImport.sources.defaultBadge')}</Badge>
                    ) : null}
                  </TableCell>
                  <TableCell className="text-right">
                    <div className="flex justify-end gap-1">
                      {source.is_default ? null : (
                        <Button
                          type="button"
                          variant="ghost"
                          size="icon"
                          aria-label={t('dataImport.sources.setDefaultAria', { label: source.label })}
                          disabled={updateSource.isPending}
                          onClick={() => handleSetDefault(source.id)}
                        >
                          <Star className="h-4 w-4" />
                        </Button>
                      )}
                      <Button
                        type="button"
                        variant="ghost"
                        size="icon"
                        aria-label={t('dataImport.sources.deleteAria', { label: source.label })}
                        onClick={() => setPendingDeleteId(source.id)}
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </TableCell>
                </TableRow>
              ))
            )}
          </TableBody>
        </Table>
      </div>

      <AlertDialog
        open={pendingDelete !== null}
        onOpenChange={(open) => {
          if (!open) setPendingDeleteId(null)
        }}
      >
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('dataImport.sources.deleteTitle')}</AlertDialogTitle>
            <AlertDialogDescription>
              {t('dataImport.sources.deleteDescription', { label: pendingDelete?.label ?? '' })}
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('common:actions.cancel')}</AlertDialogCancel>
            <AlertDialogAction onClick={handleDelete} disabled={deleteSource.isPending}>
              {t('dataImport.sources.deleteConfirm')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </section>
  )
}
