import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { components } from '@/api/generated/openapi'
import { useOpenPickerlWorkshopOrder } from '@/api/vehicles'
import { useAuthSession } from '@/api/auth-session'
import { useVehicleInspectionRecords } from '@/api/vehicle-inspection-records'
import { canRecordVehicleInspection } from '@/components/vehicles/vehicle-pickerl-permissions'
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
import { WorkshopOrderIntakeDialog } from '@/components/workshop/WorkshopOrderIntakeDialog'

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
  const [intakeOpen, setIntakeOpen] = useState(false)
  const navigate = useNavigate()
  const sessionQuery = useAuthSession()
  const canRecord = canRecordVehicleInspection(sessionQuery.data?.activeRole)
  const { data: records = [], isLoading } = useVehicleInspectionRecords(vehicleId)
  const openOrderQuery = useOpenPickerlWorkshopOrder(vehicleId)
  const hasNoInspectionRecordsWarning = pickerlDue?.warnings?.some(
    (warning) => warning.code === 'NO_INSPECTION_RECORDS',
  )

  return (
    <div className='pt-4 border-t space-y-3'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <div className='text-sm font-medium'>Pickerl (§57a)</div>
          <div className='text-xs text-muted-foreground'>
            Fälligkeit aus Erstzulassung und erfassten Begutachtungen
          </div>
        </div>
        <div className='flex gap-2'>
          {canRecord ? (
            <Button size='sm' onClick={() => setDialogOpen(true)}>
              Pickerl erfasst
            </Button>
          ) : null}
          {canRecord && openOrderQuery.data ? (
            <Button size='sm' variant='outline' onClick={() => navigate(`/workshop/orders/${openOrderQuery.data?.id}`)}>
              §57a-Auftrag öffnen
            </Button>
          ) : canRecord ? (
            <Button
              size='sm'
              variant='outline'
              disabled={openOrderQuery.isLoading || openOrderQuery.isError || openOrderQuery.data !== null}
              onClick={() => setIntakeOpen(true)}
            >
              {openOrderQuery.isLoading || openOrderQuery.isError ? 'Auftrag prüfen…' : '§57a-Auftrag anlegen'}
            </Button>
          ) : null}
        </div>
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
          {hasNoInspectionRecordsWarning
            ? 'Keine Begutachtung erfasst — bitte letzte Plakette erfassen.'
            : 'Erstzulassung fehlt — Fälligkeit kann nicht berechnet werden.'}
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
      {intakeOpen ? (
        <WorkshopOrderIntakeDialog
          open
          onOpenChange={setIntakeOpen}
          initialVehicleId={vehicleId}
          pickerlMode
        />
      ) : null}
    </div>
  )
}
