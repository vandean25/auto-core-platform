import { useEffect, useState } from 'react'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { useCreateVehicleInspectionRecord } from '@/api/vehicle-inspection-records'
import { getErrorMessage } from '@/lib/error-utils'

type RecordPickerlDialogProps = {
  vehicleId: string
  open: boolean
  onOpenChange: (open: boolean) => void
}

function formatLocalDateInput(date: Date) {
  const year = date.getFullYear()
  const month = String(date.getMonth() + 1).padStart(2, '0')
  const day = String(date.getDate()).padStart(2, '0')
  return `${year}-${month}-${day}`
}

function defaultFormValues() {
  const now = new Date()
  return {
    inspectedOn: formatLocalDateInput(now),
    dueYear: String(now.getFullYear() + 2),
    dueMonth: String(now.getMonth() + 1),
    stationName: '',
    notes: '',
  }
}

export function RecordPickerlDialog({
  vehicleId,
  open,
  onOpenChange,
}: RecordPickerlDialogProps) {
  const createRecord = useCreateVehicleInspectionRecord(vehicleId)
  const [inspectedOn, setInspectedOn] = useState(defaultFormValues().inspectedOn)
  const [dueYear, setDueYear] = useState(defaultFormValues().dueYear)
  const [dueMonth, setDueMonth] = useState(defaultFormValues().dueMonth)
  const [stationName, setStationName] = useState('')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    if (!open) {
      return
    }
    const defaults = defaultFormValues()
    setInspectedOn(defaults.inspectedOn)
    setDueYear(defaults.dueYear)
    setDueMonth(defaults.dueMonth)
    setStationName('')
    setNotes('')
  }, [open])

  async function handleSubmit() {
    try {
      await createRecord.mutateAsync({
        inspection_type: 'PICKERL_57A',
        inspected_on: inspectedOn,
        plaketten_valid_until_year: Number.parseInt(dueYear, 10),
        plaketten_valid_until_month: Number.parseInt(dueMonth, 10),
        station_name: stationName.trim() || undefined,
        notes: notes.trim() || undefined,
      })
      toast.success('Pickerl erfasst')
      onOpenChange(false)
    } catch (error) {
      toast.error(getErrorMessage(error, 'Pickerl konnte nicht gespeichert werden'))
    }
  }

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>Pickerl erfasst</DialogTitle>
        </DialogHeader>
        <div className='grid gap-4 py-2'>
          <div className='grid gap-2'>
            <Label htmlFor='pickerl-inspected-on'>Begutachtet am</Label>
            <Input
              id='pickerl-inspected-on'
              type='date'
              value={inspectedOn}
              onChange={(event) => setInspectedOn(event.target.value)}
            />
          </div>
          <div className='grid grid-cols-2 gap-3'>
            <div className='grid gap-2'>
              <Label htmlFor='pickerl-due-year'>Plakette Fälligkeit Jahr</Label>
              <Input
                id='pickerl-due-year'
                type='number'
                min={1980}
                max={2100}
                value={dueYear}
                onChange={(event) => setDueYear(event.target.value)}
              />
            </div>
            <div className='grid gap-2'>
              <Label htmlFor='pickerl-due-month'>Monat (1–12)</Label>
              <Input
                id='pickerl-due-month'
                type='number'
                min={1}
                max={12}
                value={dueMonth}
                onChange={(event) => setDueMonth(event.target.value)}
              />
            </div>
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='pickerl-station'>Prüfstelle (optional)</Label>
            <Input
              id='pickerl-station'
              value={stationName}
              onChange={(event) => setStationName(event.target.value)}
            />
          </div>
          <div className='grid gap-2'>
            <Label htmlFor='pickerl-notes'>Notiz (optional)</Label>
            <Input
              id='pickerl-notes'
              value={notes}
              onChange={(event) => setNotes(event.target.value)}
            />
          </div>
        </div>
        <DialogFooter>
          <Button variant='outline' onClick={() => onOpenChange(false)}>
            Abbrechen
          </Button>
          <Button onClick={() => void handleSubmit()} disabled={createRecord.isPending}>
            Speichern
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  )
}
