import { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useTranslation } from 'react-i18next'
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
import { InspectionImportDialog } from './InspectionImportDialog'
import { useInspectionSourceConnections } from '@/api/vehicle-inspection-imports'
import { WorkshopOrderIntakeDialog } from '@/components/workshop/WorkshopOrderIntakeDialog'

type PickerlDue = components['schemas']['PickerlDueDto']

/** Imported records are evidence: the record table offers no edit or delete for them. */
function PickerlSourceLabel({ source }: { source: string }) {
  const { t } = useTranslation('vehicles')
  if (source === 'EBV_IMPORTED') {
    return <>{t('pickerlSection.sourceEbv')}</>
  }
  if (source === 'LEGACY_IMPORT') {
    return <>{t('pickerlSection.sourceLegacy')}</>
  }
  return <>{t('pickerlSection.sourceManual')}</>
}

type VehiclePickerlSectionProps = {
  vehicleId: string
  pickerlDue?: PickerlDue | null
}

export function VehiclePickerlSection({
  vehicleId,
  pickerlDue,
}: VehiclePickerlSectionProps) {
  const { t } = useTranslation('vehicles')
  const emDash = t('shared.emDash')
  const [dialogOpen, setDialogOpen] = useState(false)
  const [importOpen, setImportOpen] = useState(false)
  const [intakeOpen, setIntakeOpen] = useState(false)
  const connectionsQuery = useInspectionSourceConnections()
  const primaryConnectionId = connectionsQuery.data?.data[0]?.id
  const navigate = useNavigate()
  const sessionQuery = useAuthSession()
  const canRecord = canRecordVehicleInspection(sessionQuery.data?.activeRole)
  const { data: records = [], isLoading } = useVehicleInspectionRecords(vehicleId)
  const openOrderQuery = useOpenPickerlWorkshopOrder(vehicleId)
  const hasNoInspectionRecordsWarning = pickerlDue?.warnings?.some(
    (warning) => warning.code === 'NO_INSPECTION_RECORDS',
  )

  function formatDueMonth(dueMonth: string | null | undefined) {
    if (!dueMonth) {
      return t('pickerlSection.unknownMonth')
    }
    const [year, month] = dueMonth.split('-')
    return `${month}/${year}`
  }

  return (
    <div className='pt-4 border-t space-y-3'>
      <div className='flex items-start justify-between gap-2'>
        <div>
          <div className='text-sm font-medium'>{t('pickerlSection.title')}</div>
          <div className='text-xs text-muted-foreground'>
            {t('pickerlSection.subtitle')}
          </div>
        </div>
        <div className='flex gap-2'>
          {canRecord ? (
            <Button size='sm' onClick={() => setDialogOpen(true)}>
              {t('pickerlSection.recordPickerl')}
            </Button>
          ) : null}
          {canRecord && primaryConnectionId ? (
            <Button
              size='sm'
              variant='outline'
              onClick={() => setImportOpen(true)}
            >
              {t('pickerlSection.importInspection')}
            </Button>
          ) : null}
          {canRecord && openOrderQuery.data ? (
            <Button size='sm' variant='outline' onClick={() => navigate(`/workshop/orders/${openOrderQuery.data?.id}`)}>
              {t('pickerlSection.openOrder')}
            </Button>
          ) : canRecord ? (
            <Button
              size='sm'
              variant='outline'
              disabled={openOrderQuery.isLoading || openOrderQuery.isError || openOrderQuery.data !== null}
              onClick={() => setIntakeOpen(true)}
            >
              {openOrderQuery.isLoading || openOrderQuery.isError
                ? t('pickerlSection.checkingOrder')
                : t('pickerlSection.createOrder')}
            </Button>
          ) : null}
        </div>
      </div>

      <div className='flex flex-wrap items-center gap-2 text-sm'>
        <span className='text-muted-foreground'>{t('pickerlSection.dueLabel')}</span>
        <span className='font-medium'>{formatDueMonth(pickerlDue?.due_month)}</span>
        {pickerlDue?.status ? (
          <StatusBadge status={pickerlDue.status} />
        ) : null}
      </div>

      {pickerlDue?.status === 'UNKNOWN' ? (
        <p className='text-xs text-muted-foreground'>
          {hasNoInspectionRecordsWarning
            ? t('pickerlSection.noInspectionRecorded')
            : t('pickerlSection.missingFirstRegistration')}
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
            <TableHead>{t('pickerlSection.columns.inspected')}</TableHead>
            <TableHead>{t('pickerlSection.columns.sticker')}</TableHead>
            <TableHead>{t('pickerlSection.columns.source')}</TableHead>
            <TableHead>{t('pickerlSection.columns.station')}</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {isLoading ? (
            <TableRow>
              <TableCell colSpan={4} className='text-muted-foreground'>
                {t('pickerlSection.loading')}
              </TableCell>
            </TableRow>
          ) : records.length === 0 ? (
            <TableRow>
              <TableCell colSpan={4} className='text-muted-foreground'>
                {t('pickerlSection.empty')}
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
                <TableCell>
                  <PickerlSourceLabel source={record.source} />
                </TableCell>
                <TableCell>{record.station_name ?? emDash}</TableCell>
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
      {primaryConnectionId ? (
        <InspectionImportDialog
          vehicleId={vehicleId}
          connectionId={primaryConnectionId}
          open={importOpen}
          onOpenChange={setImportOpen}
        />
      ) : null}
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
