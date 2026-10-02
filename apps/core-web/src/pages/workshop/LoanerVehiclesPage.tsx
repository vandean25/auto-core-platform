import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import type { LegacyColumnDef as ColumnDef } from '@tanstack/react-table/legacy'
import { format } from 'date-fns'
import { Plus, Printer } from 'lucide-react'
import { toast } from 'sonner'
import {
  useCancelLoanerBooking,
  useCreateLoanerBooking,
  useCreateLoanerVehicle,
  useHandOverLoanerBooking,
  useLoanerBookings,
  useLoanerFleet,
  useOverdueLoanerBookings,
  useReturnLoanerBooking,
  getLoanerBookingCustomerLabel,
  type LoanerBooking,
  type LoanerVehicle,
} from '@/api/loaner-vehicles'
import { DataTable } from '@/components/data-table/DataTable'
import { DataTableColumnHeader } from '@/components/data-table/data-table-column-header'
import { useDataTableQuery } from '@/hooks/useDataTableQuery'
import { StatusBadge } from '@/components/status/StatusBadge'
import { Badge } from '@/components/ui/badge'
import { Button } from '@/components/ui/button'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
import { Checkbox } from '@/components/ui/checkbox'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'

type FleetRow = {
  id: string
  displayName: string
  vehicleLabel: string
  status: LoanerVehicle['status']
  active: boolean
}

function toLocalDateTimeInput(iso?: string) {
  if (!iso) {
    const now = new Date()
    now.setMinutes(now.getMinutes() - now.getTimezoneOffset())
    return now.toISOString().slice(0, 16)
  }
  const date = new Date(iso)
  date.setMinutes(date.getMinutes() - date.getTimezoneOffset())
  return date.toISOString().slice(0, 16)
}

function fleetVehicleLabel(vehicle: LoanerVehicle) {
  if (vehicle.vehicle) {
    const plate = vehicle.vehicle.plate ? ` · ${vehicle.vehicle.plate}` : ''
    return `${vehicle.vehicle.year} ${vehicle.vehicle.make} ${vehicle.vehicle.model}${plate}`
  }
  return vehicle.displayName
}

export default function LoanerVehiclesPage() {
  const navigate = useNavigate()
  const { queryParams: _fleetTableQuery, ...tableState } = useDataTableQuery({
    defaultPageSize: 25,
  })
  const { data: fleetData, isLoading: fleetLoading } = useLoanerFleet()
  const { data: overdueData } = useOverdueLoanerBookings()
  const { data: bookingsData } = useLoanerBookings()

  const [selectedVehicleId, setSelectedVehicleId] = useState<string | null>(null)
  const [addVehicleOpen, setAddVehicleOpen] = useState(false)
  const [bookingDialogOpen, setBookingDialogOpen] = useState(false)
  const [handOverBooking, setHandOverBooking] = useState<LoanerBooking | null>(null)
  const [returnBooking, setReturnBooking] = useState<LoanerBooking | null>(null)

  const [newVehicleId, setNewVehicleId] = useState('')
  const [newDisplayName, setNewDisplayName] = useState('')

  const [bookingCustomerId, setBookingCustomerId] = useState('')
  const [bookingWorkshopOrderId, setBookingWorkshopOrderId] = useState('')
  const [bookingPlannedFrom, setBookingPlannedFrom] = useState(() => toLocalDateTimeInput())
  const [bookingPlannedTo, setBookingPlannedTo] = useState(() => {
    const end = new Date()
    end.setDate(end.getDate() + 1)
    return toLocalDateTimeInput(end.toISOString())
  })

  const [handOverOdometer, setHandOverOdometer] = useState('')
  const [handOverFuel, setHandOverFuel] = useState('')
  const [handOverLicenceChecked, setHandOverLicenceChecked] = useState(true)
  const [handOverDamageNotes, setHandOverDamageNotes] = useState('')

  const [returnOdometer, setReturnOdometer] = useState('')
  const [returnFuel, setReturnFuel] = useState('')
  const [returnDamageNotes, setReturnDamageNotes] = useState('')

  const createVehicle = useCreateLoanerVehicle()
  const createBooking = useCreateLoanerBooking()
  const cancelBooking = useCancelLoanerBooking()
  const handOver = useHandOverLoanerBooking()
  const returnLoaner = useReturnLoanerBooking()

  const overdueCount = overdueData?.data?.length ?? 0

  const vehicleBookings = useMemo(() => {
    if (!selectedVehicleId) return []
    return (bookingsData?.data ?? []).filter(
      (booking) => booking.loanerVehicleId === selectedVehicleId,
    )
  }, [bookingsData, selectedVehicleId])

  const rows = useMemo<FleetRow[]>(() => {
    return (fleetData?.data ?? []).map((vehicle) => ({
      id: vehicle.id,
      displayName: vehicle.displayName,
      vehicleLabel: fleetVehicleLabel(vehicle),
      status: vehicle.status,
      active: vehicle.active,
    }))
  }, [fleetData])

  const columns: ColumnDef<FleetRow>[] = [
    {
      accessorKey: 'displayName',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Name' />,
    },
    {
      accessorKey: 'vehicleLabel',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Fahrzeug' />,
    },
    {
      accessorKey: 'status',
      header: ({ column }) => <DataTableColumnHeader column={column} title='Status' />,
      cell: ({ row }) => <StatusBadge status={row.original.status} />,
    },
  ]

  async function handleCreateVehicle() {
    if (!newVehicleId.trim() || !newDisplayName.trim()) {
      toast.error('Fahrzeug-ID und Anzeigename sind erforderlich')
      return
    }
    try {
      await createVehicle.mutateAsync({
        vehicleId: newVehicleId.trim(),
        displayName: newDisplayName.trim(),
      })
      toast.success('Ersatzfahrzeug hinzugefügt')
      setAddVehicleOpen(false)
      setNewVehicleId('')
      setNewDisplayName('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Speichern fehlgeschlagen')
    }
  }

  async function handleCreateBooking() {
    if (!selectedVehicleId) {
      toast.error('Bitte zuerst ein Ersatzfahrzeug auswählen')
      return
    }
    if (!bookingCustomerId.trim()) {
      toast.error('Kunden-ID ist erforderlich')
      return
    }
    try {
      await createBooking.mutateAsync({
        loanerVehicleId: selectedVehicleId,
        customerId: bookingCustomerId.trim(),
        workshopOrderId: bookingWorkshopOrderId.trim() || undefined,
        plannedFrom: new Date(bookingPlannedFrom).toISOString(),
        plannedTo: new Date(bookingPlannedTo).toISOString(),
      })
      toast.success('Buchung angelegt')
      setBookingDialogOpen(false)
      setBookingCustomerId('')
      setBookingWorkshopOrderId('')
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Buchung fehlgeschlagen')
    }
  }

  async function handleHandOver() {
    if (!handOverBooking) return
    try {
      await handOver.mutateAsync({
        id: handOverBooking.id,
        data: {
          odometerOut: Number(handOverOdometer),
          fuelOut: Number(handOverFuel),
          driverLicenceChecked: handOverLicenceChecked,
          damageNotesOut: handOverDamageNotes.trim() || undefined,
        },
      })
      toast.success('Übergabe protokolliert')
      setHandOverBooking(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Übergabe fehlgeschlagen')
    }
  }

  async function handleReturn() {
    if (!returnBooking) return
    try {
      await returnLoaner.mutateAsync({
        id: returnBooking.id,
        data: {
          odometerIn: Number(returnOdometer),
          fuelIn: Number(returnFuel),
          damageNotesIn: returnDamageNotes.trim() || undefined,
        },
      })
      toast.success('Rückgabe protokolliert')
      setReturnBooking(null)
    } catch (error) {
      toast.error(error instanceof Error ? error.message : 'Rückgabe fehlgeschlagen')
    }
  }

  function openHandOverDialog(booking: LoanerBooking) {
    setHandOverOdometer('')
    setHandOverFuel('')
    setHandOverLicenceChecked(true)
    setHandOverDamageNotes('')
    setHandOverBooking(booking)
  }

  function openReturnDialog(booking: LoanerBooking) {
    setReturnOdometer('')
    setReturnFuel('')
    setReturnDamageNotes('')
    setReturnBooking(booking)
  }

  const selectedVehicle = fleetData?.data?.find((v) => v.id === selectedVehicleId)

  return (
    <div className='space-y-6'>
      <div className='mb-8 flex items-center justify-between'>
        <div>
          <div className='flex items-center gap-3'>
            <h1 className='text-2xl font-semibold tracking-tight'>Ersatzfahrzeuge</h1>
            {overdueCount > 0 ? (
              <Badge variant='destructive' className='tabular-nums'>
                {overdueCount} überfällig
              </Badge>
            ) : null}
          </div>
          <p className='text-slate-500'>
            Flotte verwalten, Buchungen planen und Übergabe/Rückgabe dokumentieren.
          </p>
        </div>
        <Button onClick={() => setAddVehicleOpen(true)}>
          <Plus className='mr-2 h-4 w-4' />
          Ersatzfahrzeug
        </Button>
      </div>

      <DataTable
        columns={columns}
        data={rows}
        isLoading={fleetLoading}
        pageCount={1}
        searchPlaceholder='Ersatzfahrzeuge suchen…'
        getRowAccessibleName={(row) => `Ersatzfahrzeug ${row.displayName}`}
        onRowClick={(row) =>
          setSelectedVehicleId((current) => (current === row.id ? null : row.id))
        }
        {...tableState}
      />

      {selectedVehicleId && selectedVehicle ? (
        <Card>
          <CardHeader className='flex flex-row items-center justify-between space-y-0'>
            <div>
              <CardTitle>Buchungen · {selectedVehicle.displayName}</CardTitle>
              <p className='text-sm text-muted-foreground'>{fleetVehicleLabel(selectedVehicle)}</p>
            </div>
            <Button variant='outline' onClick={() => setBookingDialogOpen(true)}>
              <Plus className='mr-2 h-4 w-4' />
              Buchung
            </Button>
          </CardHeader>
          <CardContent>
            {vehicleBookings.length === 0 ? (
              <p className='text-sm text-muted-foreground'>Keine Buchungen für dieses Fahrzeug.</p>
            ) : (
              <ol className='relative space-y-6 border-l border-slate-200 pl-6'>
                {vehicleBookings.map((booking) => (
                  <li key={booking.id} className='relative'>
                    <span className='absolute -left-[9px] top-1 h-4 w-4 rounded-full border-2 border-white bg-sky-500 ring-1 ring-sky-200' />
                    <div className='flex flex-col gap-2 rounded-lg border border-slate-200 bg-white p-4 sm:flex-row sm:items-start sm:justify-between'>
                      <div className='space-y-1'>
                        <div className='flex flex-wrap items-center gap-2'>
                          <StatusBadge status={booking.status} />
                          <span className='text-sm text-muted-foreground'>
                            {format(new Date(booking.plannedFrom), 'PPp')} –{' '}
                            {format(new Date(booking.plannedTo), 'PPp')}
                          </span>
                        </div>
                        <p className='font-medium'>{getLoanerBookingCustomerLabel(booking)}</p>
                        {booking.workshopOrderId ? (
                          <p className='text-xs text-muted-foreground'>
                            Werkstattauftrag: {booking.workshopOrderId}
                          </p>
                        ) : null}
                      </div>
                      <div className='flex flex-wrap gap-2'>
                        {booking.status === 'RESERVED' ? (
                          <Button size='sm' onClick={() => openHandOverDialog(booking)}>
                            Übergabe
                          </Button>
                        ) : null}
                        {booking.status === 'HANDED_OVER' ? (
                          <Button size='sm' onClick={() => openReturnDialog(booking)}>
                            Rückgabe
                          </Button>
                        ) : null}
                        {(booking.status === 'HANDED_OVER' || booking.status === 'RETURNED') && (
                          <Button
                            size='sm'
                            variant='outline'
                            onClick={() =>
                              navigate(
                                APP_ROUTE_PATHS.workshopLoanerBookingPrint.replace(
                                  ':id',
                                  booking.id,
                                ),
                              )
                            }
                          >
                            <Printer className='mr-2 h-4 w-4' />
                            Protokoll
                          </Button>
                        )}
                        {booking.status === 'RESERVED' ? (
                          <Button
                            size='sm'
                            variant='ghost'
                            onClick={() =>
                              cancelBooking.mutate(booking.id, {
                                onSuccess: () => toast.success('Buchung storniert'),
                                onError: (error) =>
                                  toast.error(
                                    error instanceof Error ? error.message : 'Storno fehlgeschlagen',
                                  ),
                              })
                            }
                          >
                            Stornieren
                          </Button>
                        ) : null}
                      </div>
                    </div>
                  </li>
                ))}
              </ol>
            )}
          </CardContent>
        </Card>
      ) : null}

      {overdueCount > 0 ? (
        <Card className='border-rose-200 bg-rose-50/40'>
          <CardHeader>
            <CardTitle className='text-rose-900'>Überfällige Rückgaben</CardTitle>
          </CardHeader>
          <CardContent className='space-y-2'>
            {(overdueData?.data ?? []).map((booking) => (
              <div
                key={booking.id}
                className='flex flex-wrap items-center justify-between gap-2 rounded-md border border-rose-100 bg-white px-3 py-2 text-sm'
              >
                <span>
                  {getLoanerBookingCustomerLabel(booking)} · bis{' '}
                  {format(new Date(booking.plannedTo), 'PPp')}
                </span>
                <Button size='sm' variant='outline' onClick={() => openReturnDialog(booking)}>
                  Rückgabe
                </Button>
              </div>
            ))}
          </CardContent>
        </Card>
      ) : null}

      <Dialog open={addVehicleOpen} onOpenChange={setAddVehicleOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Ersatzfahrzeug hinzufügen</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='loaner-vehicle-id'>Fahrzeug-ID (UUID)</Label>
              <Input
                id='loaner-vehicle-id'
                value={newVehicleId}
                onChange={(event) => setNewVehicleId(event.target.value)}
                placeholder='Vehicle UUID'
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='loaner-display-name'>Anzeigename</Label>
              <Input
                id='loaner-display-name'
                value={newDisplayName}
                onChange={(event) => setNewDisplayName(event.target.value)}
                placeholder='z. B. Golf Ersatzwagen'
              />
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setAddVehicleOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleCreateVehicle} disabled={createVehicle.isPending}>
              Speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={bookingDialogOpen} onOpenChange={setBookingDialogOpen}>
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Neue Buchung</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='booking-customer-id'>Kunden-ID</Label>
              <Input
                id='booking-customer-id'
                value={bookingCustomerId}
                onChange={(event) => setBookingCustomerId(event.target.value)}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='booking-order-id'>Werkstattauftrag (optional)</Label>
              <Input
                id='booking-order-id'
                value={bookingWorkshopOrderId}
                onChange={(event) => setBookingWorkshopOrderId(event.target.value)}
              />
            </div>
            <div className='grid gap-4 sm:grid-cols-2'>
              <div className='space-y-2'>
                <Label htmlFor='booking-from'>Geplant von</Label>
                <Input
                  id='booking-from'
                  type='datetime-local'
                  value={bookingPlannedFrom}
                  onChange={(event) => setBookingPlannedFrom(event.target.value)}
                />
              </div>
              <div className='space-y-2'>
                <Label htmlFor='booking-to'>Geplant bis</Label>
                <Input
                  id='booking-to'
                  type='datetime-local'
                  value={bookingPlannedTo}
                  onChange={(event) => setBookingPlannedTo(event.target.value)}
                />
              </div>
            </div>
          </div>
          <DialogFooter>
            <Button variant='outline' onClick={() => setBookingDialogOpen(false)}>
              Abbrechen
            </Button>
            <Button onClick={handleCreateBooking} disabled={createBooking.isPending}>
              Buchung anlegen
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(handOverBooking)} onOpenChange={(open) => !open && setHandOverBooking(null)}>
        <DialogContent className='max-w-lg'>
          <DialogHeader>
            <DialogTitle>Übergabe protokollieren</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='handover-odometer'>Kilometerstand</Label>
              <Input
                id='handover-odometer'
                type='number'
                className='h-12 text-lg'
                value={handOverOdometer}
                onChange={(event) => setHandOverOdometer(event.target.value)}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='handover-fuel'>Tankfüllung (%)</Label>
              <Input
                id='handover-fuel'
                type='number'
                className='h-12 text-lg'
                value={handOverFuel}
                onChange={(event) => setHandOverFuel(event.target.value)}
              />
            </div>
            <div className='flex items-center gap-3'>
              <Checkbox
                id='handover-licence'
                checked={handOverLicenceChecked}
                onCheckedChange={(checked) => setHandOverLicenceChecked(checked === true)}
              />
              <Label htmlFor='handover-licence' className='text-base'>
                Führerschein geprüft
              </Label>
            </div>
            <div className='space-y-2'>
              <Label htmlFor='handover-damage'>Schäden / Notizen (Ausgabe)</Label>
              <textarea
                id='handover-damage'
                className='flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                value={handOverDamageNotes}
                onChange={(event) => setHandOverDamageNotes(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter className='gap-2 sm:gap-0'>
            <Button variant='outline' onClick={() => setHandOverBooking(null)}>
              Abbrechen
            </Button>
            <Button className='h-11 px-6 text-base' onClick={handleHandOver} disabled={handOver.isPending}>
              Übergabe speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <Dialog open={Boolean(returnBooking)} onOpenChange={(open) => !open && setReturnBooking(null)}>
        <DialogContent className='max-w-lg'>
          <DialogHeader>
            <DialogTitle>Rückgabe protokollieren</DialogTitle>
          </DialogHeader>
          <div className='space-y-4'>
            <div className='space-y-2'>
              <Label htmlFor='return-odometer'>Kilometerstand</Label>
              <Input
                id='return-odometer'
                type='number'
                className='h-12 text-lg'
                value={returnOdometer}
                onChange={(event) => setReturnOdometer(event.target.value)}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='return-fuel'>Tankfüllung (%)</Label>
              <Input
                id='return-fuel'
                type='number'
                className='h-12 text-lg'
                value={returnFuel}
                onChange={(event) => setReturnFuel(event.target.value)}
              />
            </div>
            <div className='space-y-2'>
              <Label htmlFor='return-damage'>Schäden / Notizen (Rückgabe)</Label>
              <textarea
                id='return-damage'
                className='flex min-h-[100px] w-full rounded-md border border-input bg-background px-3 py-2 text-base ring-offset-background focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring'
                value={returnDamageNotes}
                onChange={(event) => setReturnDamageNotes(event.target.value)}
              />
            </div>
          </div>
          <DialogFooter className='gap-2 sm:gap-0'>
            <Button variant='outline' onClick={() => setReturnBooking(null)}>
              Abbrechen
            </Button>
            <Button className='h-11 px-6 text-base' onClick={handleReturn} disabled={returnLoaner.isPending}>
              Rückgabe speichern
            </Button>
          </DialogFooter>
        </DialogContent>
      </Dialog>
    </div>
  )
}
