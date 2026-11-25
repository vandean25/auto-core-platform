import { useState } from 'react'
import { useTranslation } from 'react-i18next'
import { Loader2, Pencil, Pin, PinOff, Trash2 } from 'lucide-react'
import { toast } from 'sonner'
import {
  useCreateCustomerNote,
  useCustomerNotes,
  useDeleteCustomerNote,
  usePinCustomerNote,
  useUpdateCustomerNote,
  type CustomerNote,
} from '@/api/customers'
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
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Skeleton } from '@/components/ui/skeleton'
import { canManageCustomerNotes } from '@/features/actions/action-role-predicates'
import { useAuthSession } from '@/api/auth-session'
import { formatDateTime } from '@/lib/format'
import { formatTenantMemberRole } from '@/lib/i18n'

const TEXTAREA_CLASS =
  'flex min-h-[60px] w-full rounded-md border border-input bg-transparent px-3 py-2 text-sm shadow-xs placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-1 focus-visible:ring-ring disabled:cursor-not-allowed disabled:opacity-50'

function NoteLegalHint({ text }: { text: string }) {
  return (
    <p
      data-testid='customer-note-legal-hint'
      className='rounded-md border border-border bg-muted/50 px-3 py-2 text-xs text-muted-foreground'
    >
      {text}
    </p>
  )
}

function NoteCreateForm({
  customerId,
}: {
  customerId: string
}) {
  const { t } = useTranslation('customers')
  const createNote = useCreateCustomerNote(customerId)
  const [draftBody, setDraftBody] = useState('')

  async function handleCreate(event: React.FormEvent) {
    event.preventDefault()
    const trimmed = draftBody.trim()
    if (!trimmed) return
    try {
      await createNote.mutateAsync({ body: trimmed })
      setDraftBody('')
      toast.success(t('notes.createSuccess'))
    } catch {
      toast.error(t('notes.createFailed'))
    }
  }

  return (
    <form onSubmit={handleCreate} className='space-y-2'>
      <textarea
        value={draftBody}
        onChange={(event) => setDraftBody(event.target.value)}
        placeholder={t('notes.placeholder')}
        aria-label={t('notes.placeholder')}
        rows={2}
        maxLength={4000}
        className={TEXTAREA_CLASS}
      />
      <NoteLegalHint text={t('notes.legalHint')} />
      <div className='flex justify-end'>
        <Button
          type='submit'
          size='sm'
          className='max-sm:min-h-11'
          disabled={createNote.isPending || !draftBody.trim()}
        >
          {createNote.isPending ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
          {t('notes.addAction')}
        </Button>
      </div>
    </form>
  )
}

function CustomerNoteEditForm({
  initialBody,
  isSaving,
  onCancel,
  onSave,
}: {
  initialBody: string
  isSaving: boolean
  onCancel: () => void
  onSave: (body: string) => Promise<void>
}) {
  const { t } = useTranslation('customers')
  const [editBody, setEditBody] = useState(initialBody)

  return (
    <div className='space-y-2'>
      <textarea
        value={editBody}
        onChange={(event) => setEditBody(event.target.value)}
        placeholder={t('notes.editPlaceholder')}
        aria-label={t('notes.editPlaceholder')}
        rows={2}
        maxLength={4000}
        className={TEXTAREA_CLASS}
      />
      <NoteLegalHint text={t('notes.legalHint')} />
      <div className='flex justify-end gap-2'>
        <Button
          type='button'
          variant='outline'
          size='sm'
          className='max-sm:min-h-11'
          onClick={onCancel}
        >
          {t('notes.cancelAction')}
        </Button>
        <Button
          type='button'
          size='sm'
          className='max-sm:min-h-11'
          disabled={isSaving || !editBody.trim()}
          onClick={() => void onSave(editBody.trim())}
        >
          {isSaving ? <Loader2 className='mr-2 h-4 w-4 animate-spin' /> : null}
          {t('notes.saveAction')}
        </Button>
      </div>
    </div>
  )
}

function CustomerNoteActions({
  note,
  onTogglePin,
  onEdit,
  onDelete,
}: {
  note: CustomerNote
  onTogglePin: (note: CustomerNote) => void
  onEdit: () => void
  onDelete: (note: CustomerNote) => void
}) {
  const { t } = useTranslation('customers')
  return (
    <div className='flex items-center gap-1'>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='h-8 w-8 max-sm:min-h-11 max-sm:min-w-11'
        aria-label={note.pinned ? t('notes.unpinAction') : t('notes.pinAction')}
        onClick={() => onTogglePin(note)}
      >
        {note.pinned ? <PinOff className='h-4 w-4' /> : <Pin className='h-4 w-4' />}
      </Button>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='h-8 w-8 max-sm:min-h-11 max-sm:min-w-11'
        aria-label={t('notes.editAction')}
        onClick={onEdit}
      >
        <Pencil className='h-4 w-4' />
      </Button>
      <Button
        type='button'
        variant='ghost'
        size='icon'
        className='h-8 w-8 max-sm:min-h-11 max-sm:min-w-11 text-destructive hover:text-destructive'
        aria-label={t('notes.deleteAction')}
        onClick={() => onDelete(note)}
      >
        <Trash2 className='h-4 w-4' />
      </Button>
    </div>
  )
}

function CustomerNoteRow({
  note,
  canManage,
  onSaveEdit,
  isSavingEdit,
  onTogglePin,
  onRequestDelete,
}: {
  note: CustomerNote
  canManage: boolean
  onSaveEdit: (noteId: string, body: string) => Promise<boolean>
  isSavingEdit: boolean
  onTogglePin: (note: CustomerNote) => void
  onRequestDelete: (note: CustomerNote) => void
}) {
  const { t } = useTranslation('customers')
  const [isEditing, setIsEditing] = useState(false)

  async function handleSave(trimmed: string) {
    if (!trimmed) return
    const ok = await onSaveEdit(note.id, trimmed)
    if (ok) {
      setIsEditing(false)
    }
  }

  return (
    <li
      data-testid={`customer-note-item-${note.id}`}
      data-pinned={note.pinned ? 'true' : 'false'}
      className='rounded-md border border-border bg-card p-3 space-y-2'
    >
      {isEditing ? (
        <CustomerNoteEditForm
          initialBody={note.body}
          isSaving={isSavingEdit}
          onCancel={() => setIsEditing(false)}
          onSave={handleSave}
        />
      ) : (
        <>
          <div className='flex items-start justify-between gap-2'>
            <p className='text-sm whitespace-pre-wrap break-words flex-1'>{note.body}</p>
            {note.pinned ? (
              <Badge variant='secondary' className='shrink-0 gap-1'>
                <Pin className='h-3 w-3' />
                {t('notes.pinnedBadge')}
              </Badge>
            ) : null}
          </div>
          <div className='flex flex-wrap items-center justify-between gap-2 text-xs text-muted-foreground'>
            <span>
              {formatDateTime(note.created_at)}
              {note.author_role ? ` · ${formatTenantMemberRole(note.author_role)}` : ''}
            </span>
            {canManage ? (
              <CustomerNoteActions
                note={note}
                onTogglePin={onTogglePin}
                onEdit={() => setIsEditing(true)}
                onDelete={onRequestDelete}
              />
            ) : null}
          </div>
        </>
      )}
    </li>
  )
}

export function CustomerNotesCard({ customerId }: { customerId: string }) {
  const { t } = useTranslation('customers')
  const { data: session } = useAuthSession()
  const canManage = canManageCustomerNotes(session?.activeRole)
  const { data, isLoading, error, refetch } = useCustomerNotes(customerId)
  const updateNote = useUpdateCustomerNote(customerId)
  const pinNote = usePinCustomerNote(customerId)
  const deleteNote = useDeleteCustomerNote(customerId)
  const [deletingNote, setDeletingNote] = useState<CustomerNote | null>(null)

  const notes = [...(data?.data ?? [])].sort((a, b) => {
    if (a.pinned !== b.pinned) return a.pinned ? -1 : 1
    return new Date(b.created_at).getTime() - new Date(a.created_at).getTime()
  })

  async function handleSaveEdit(noteId: string, body: string): Promise<boolean> {
    try {
      await updateNote.mutateAsync({ noteId, body })
      toast.success(t('notes.updateSuccess'))
      return true
    } catch {
      toast.error(t('notes.updateFailed'))
      return false
    }
  }

  async function handleTogglePin(note: CustomerNote) {
    try {
      await pinNote.mutateAsync({ noteId: note.id, pinned: !note.pinned })
    } catch {
      toast.error(t('notes.pinFailed'))
    }
  }

  async function handleConfirmDelete() {
    if (!deletingNote) return
    try {
      await deleteNote.mutateAsync({ noteId: deletingNote.id })
      setDeletingNote(null)
      toast.success(t('notes.deleteSuccess'))
    } catch {
      toast.error(t('notes.deleteFailed'))
    }
  }

  return (
    <Card data-testid='customer-notes-card'>
      <CardHeader>
        <CardTitle className='text-base font-semibold'>{t('notes.title')}</CardTitle>
      </CardHeader>
      <CardContent className='space-y-4'>
        {canManage ? <NoteCreateForm customerId={customerId} /> : null}

        {isLoading ? (
          <div role='status' className='space-y-2' aria-label={t('notes.loading')}>
            <Skeleton className='h-14 w-full' />
            <Skeleton className='h-14 w-full' />
          </div>
        ) : error ? (
          <div className='space-y-2 text-sm text-muted-foreground'>
            <p>{t('notes.loadFailed')}</p>
            <Button
              variant='outline'
              size='sm'
              onClick={() => refetch()}
            >
              {t('activity.retry')}
            </Button>
          </div>
        ) : notes.length === 0 ? (
          <p className='text-sm text-muted-foreground'>{t('notes.empty')}</p>
        ) : (
          <ul className='space-y-3' data-testid='customer-notes-list'>
            {notes.map((note) => (
              <CustomerNoteRow
                key={note.id}
                note={note}
                canManage={canManage}
                onSaveEdit={handleSaveEdit}
                isSavingEdit={updateNote.isPending}
                onTogglePin={(item) => void handleTogglePin(item)}
                onRequestDelete={setDeletingNote}
              />
            ))}
          </ul>
        )}
      </CardContent>

      <AlertDialog open={!!deletingNote} onOpenChange={(open) => !open && setDeletingNote(null)}>
        <AlertDialogContent>
          <AlertDialogHeader>
            <AlertDialogTitle>{t('notes.deleteConfirmTitle')}</AlertDialogTitle>
            <AlertDialogDescription>{t('notes.deleteConfirmDescription')}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter>
            <AlertDialogCancel>{t('notes.cancelAction')}</AlertDialogCancel>
            <AlertDialogAction onClick={() => void handleConfirmDelete()}>
              {t('notes.deleteAction')}
            </AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </Card>
  )
}
