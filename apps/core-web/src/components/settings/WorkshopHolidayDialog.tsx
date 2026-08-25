import * as React from 'react'
import { toast } from 'sonner'

import {
  type CreateWorkshopHolidayPayload,
  type WorkshopHoliday,
  useCreateWorkshopHoliday,
  useUpdateWorkshopHoliday,
} from '@/api/workshop'
import { Button } from '@/components/ui/button'
import { Checkbox } from '@/components/ui/checkbox'
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
import { getErrorMessage } from '@/lib/error-utils'

type WorkshopHolidayDialogProps = {
  open: boolean
  onOpenChange: (open: boolean) => void
  holiday?: WorkshopHoliday | null
}

type FormState = {
  name: string
  observedOn: string
  repeatsAnnually: boolean
  isClosed: boolean
  openTime: string
  closeTime: string
}

const defaultFormState: FormState = {
  name: '',
  observedOn: '',
  repeatsAnnually: false,
  isClosed: true,
  openTime: '08:00',
  closeTime: '12:00',
}

function toFormState(holiday?: WorkshopHoliday | null): FormState {
  if (!holiday) return defaultFormState

  return {
    name: holiday.name,
    observedOn: holiday.observedOn,
    repeatsAnnually: holiday.repeatsAnnually,
    isClosed: holiday.isClosed,
    openTime: holiday.openTime ?? '08:00',
    closeTime: holiday.closeTime ?? '12:00',
  }
}

export function WorkshopHolidayDialog({
  open,
  onOpenChange,
  holiday,
}: WorkshopHolidayDialogProps) {
  const createMutation = useCreateWorkshopHoliday()
  const updateMutation = useUpdateWorkshopHoliday()
  const [formState, setFormState] = React.useState<FormState>(defaultFormState)

  React.useEffect(() => {
    if (!open) return
    setFormState(toFormState(holiday))
  }, [holiday, open])

  const isEditing = Boolean(holiday)
  const isPending = createMutation.isPending || updateMutation.isPending

  const handleSubmit = async (event: React.FormEvent) => {
    event.preventDefault()

    const name = formState.name.trim()
    if (!name) {
      toast.error('Holiday name is required')
      return
    }

    if (!formState.observedOn) {
      toast.error('Date is required')
      return
    }

    if (!formState.isClosed && formState.closeTime <= formState.openTime) {
      toast.error('Close time must be after open time')
      return
    }

    const payload: CreateWorkshopHolidayPayload = {
      name,
      observedOn: formState.observedOn,
      repeatsAnnually: formState.repeatsAnnually,
      isClosed: formState.isClosed,
      ...(formState.isClosed
        ? {}
        : {
            openTime: formState.openTime,
            closeTime: formState.closeTime,
          }),
    }

    try {
      if (isEditing && holiday) {
        await updateMutation.mutateAsync({ id: holiday.id, payload })
        toast.success('Holiday updated')
      } else {
        await createMutation.mutateAsync(payload)
        toast.success('Holiday created')
      }
      onOpenChange(false)
    } catch (error: unknown) {
      toast.error(getErrorMessage(error, 'Failed to save holiday'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{isEditing ? 'Edit Holiday' : 'Create Holiday'}</DialogTitle>
          <DialogDescription>
            Override weekday hours for a specific date. Closed days block the grid; short days use custom hours.
          </DialogDescription>
        </DialogHeader>

        <form onSubmit={handleSubmit} className='space-y-4'>
          <div className='space-y-2'>
            <Label htmlFor='holiday-name'>Name</Label>
            <Input
              id='holiday-name'
              value={formState.name}
              onChange={(event) => {
                setFormState((previous) => ({ ...previous, name: event.target.value }))
              }}
              placeholder='Nationalfeiertag'
              required
            />
          </div>

          <div className='space-y-2'>
            <Label htmlFor='holiday-date'>Date</Label>
            <Input
              id='holiday-date'
              type='date'
              value={formState.observedOn}
              onChange={(event) => {
                setFormState((previous) => ({ ...previous, observedOn: event.target.value }))
              }}
              required
            />
          </div>

          <div className='flex items-center gap-2'>
            <Checkbox
              id='holiday-annual'
              checked={formState.repeatsAnnually}
              onCheckedChange={(checked) => {
                setFormState((previous) => ({
                  ...previous,
                  repeatsAnnually: checked === true,
                }))
              }}
            />
            <Label htmlFor='holiday-annual'>Repeats annually (same month and day)</Label>
          </div>

          <div className='flex items-center gap-2'>
            <Checkbox
              id='holiday-closed'
              checked={formState.isClosed}
              onCheckedChange={(checked) => {
                setFormState((previous) => ({
                  ...previous,
                  isClosed: checked === true,
                }))
              }}
            />
            <Label htmlFor='holiday-closed'>Closed all day</Label>
          </div>

          {!formState.isClosed ? (
            <div className='grid grid-cols-2 gap-4'>
              <div className='space-y-2'>
                <Label htmlFor='holiday-open'>Open</Label>
                <Input
                  id='holiday-open'
                  type='time'
                  value={formState.openTime}
                  onChange={(event) => {
                    setFormState((previous) => ({ ...previous, openTime: event.target.value }))
                  }}
                  required
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='holiday-close'>Close</Label>
                <Input
                  id='holiday-close'
                  type='time'
                  value={formState.closeTime}
                  onChange={(event) => {
                    setFormState((previous) => ({ ...previous, closeTime: event.target.value }))
                  }}
                  required
                />
              </div>
            </div>
          ) : null}

          <DialogFooter>
            <Button type='button' variant='outline' onClick={() => onOpenChange(false)}>
              Cancel
            </Button>
            <Button type='submit' disabled={isPending}>
              {isPending ? 'Saving...' : isEditing ? 'Save' : 'Create'}
            </Button>
          </DialogFooter>
        </form>
      </DialogContent>
    </Dialog>
  )
}
