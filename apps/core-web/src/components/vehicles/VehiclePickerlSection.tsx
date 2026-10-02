import { useState } from 'react'
import type { components } from '@/api/generated/openapi'
import { useVehicleInspectionRecords } from '@/api/vehicle-inspection-records'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Button } from '@/components/ui/button'
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from '@/components/ui/table'
import { RecordPickerlDialog } from './RecordPickerlDialog'

type PickerlDue = components['schemas']['PickerlDueDto']

type VehiclePickerlSectionProps = {
  vehicleId: string
  pickerlDue?: PickerlDue | null
}

function formatDueMonth(dueMonth: string | null | undefined) {
  if (!dueMonth) {
    return 'Unbekannt'
  }
  const [year, month] = dueMonth.split('-')
  return `${month}/${year}`
}

export function VehiclePickerlSection({
  vehicleId,
  pickerlDue,
}: VehiclePickerlSectionProps) {
  const [dialogOpen, setDialogOpen] = useState(false)
  const { data: records = [], isLoading } = useVehicleInspectionRecords(vehicleId)

  return (
    <div className='pt-4 border-t space-y-3'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <div className='text-sm font-medium'>Pickerl (§57a)</div>
          <div className='text-xs text-muted-foreground'>
            Fälligkeit aus Erstzulassung und erfassten Begutachtungen
          </div>
        </div>
        <Button size='sm' onClick={() => setDialogOpen(true)}>
          Pickerl erfasst
        </Button>
      </div>

      <div className='flex flex-wrap items-center gap-2 text-sm'>
        <span className='text-muted-foreground'>Fällig:</span>
        <span className='font-medium'>{formatDueMonth(pickerlDue?.due_month)}</span>
        {pickerlDue?.status ? (
          <StatusBadge status={pickerlDue.status} />
        ) : null}
      </div>

      {pickerlDue?.status === 'UNKNOWN' ? (
        <p className='text-xs text-muted-foreground'>
          Erstzulassung fehlt — Fälligkeit kann nicht berechnet werden.
        </p>
      ) : null}

      {pickerlDue?.warnings?.length ? (
        <ul className='text-xs text-amber-700 list-disc pl-4 space-y-1'>
          {pickerlDue.warnings.map((warning) => (
            <li key={warning.code}>{warning.message}</li>
          ))}
        </ul>
      ) : null}

      <Table>
        <TableHeader>
          <TableRow>
            <TableHead>Begutachtet</TableHead>
            <TableHead>Plakette</TableHead>
            <TableHead>Prüfstelle</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={3} className='text-muted-foreground'>
                Laden…
              </TableCell>
            </TableRow>
          ) : records.length === 0 ? (
            <TableRow>
              <TableCell colSpan={3} className='text-muted-foreground'>
                Noch keine Begutachtung erfasst.
              </TableCell>
            </TableRow>
          ) : (
            records.map((record) => (
              <TableRow key={record.id}>
                <TableCell>
                  {typeof record.inspected_on === 'string'
                    ? record.inspected_on.slice(0, 10)
                    : record.inspected_on}
                </TableCell>
                <TableCell>
                  {String(record.plaketten_valid_until_month).padStart(2, '0')}/
                  {record.plaketten_valid_until_year}
                </TableCell>
                <TableCell>{record.station_name ?? '—'}</TableCell>
              </TableRow>
            ))
          )}
        </TableBody>
      </Table>

      <RecordPickerlDialog
        vehicleId={vehicleId}
        open={dialogOpen}
        onOpenChange={setDialogOpen}
      />
    </div>
  )
}
