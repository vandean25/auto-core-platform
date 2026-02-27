import { useEffect, useMemo, useState } from 'react'
import type { Customer, RegisterIntakePayload, Vehicle, WorkshopSearchResponse } from '@/api/types'
import { useCreateWorkshopOrder, useRegisterIntake, useWorkshopSearch } from '@/api/workshop'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Button } from '@/components/ui/button'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'

type ExistingVehicle = Vehicle & { customer: Customer | null }
type ExistingCustomer = Customer & { vehicles: Vehicle[] }

interface WorkshopOrderIntakeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
}

interface NewVehicleForm {
  vin: string
  plate: string
  make: string
  model: string
  year: string
}

interface NewCustomerForm {
  firstName: string
  lastName: string
  email: string
  phone: string
}

export function WorkshopOrderIntakeDialog({ open, onOpenChange }: WorkshopOrderIntakeDialogProps) {
  const navigate = useNavigate()
  const createOrder = useCreateWorkshopOrder()
  const registerIntake = useRegisterIntake()

  const [activeTab, setActiveTab] = useState<'existing' | 'new-vehicle'>('existing')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedVehicle, setSelectedVehicle] = useState<ExistingVehicle | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<ExistingCustomer | null>(null)
  const [customerMode, setCustomerMode] = useState<'existing' | 'new'>('existing')

  const [newVehicle, setNewVehicle] = useState<NewVehicleForm>({
    vin: '',
    plate: '',
    make: '',
    model: '',
    year: String(new Date().getFullYear()),
  })

  const [newCustomer, setNewCustomer] = useState<NewCustomerForm>({
    firstName: '',
    lastName: '',
    email: '',
    phone: '',
  })

  const [odometer, setOdometer] = useState('')
  const [fuelLevel, setFuelLevel] = useState('50')
  const [notes, setNotes] = useState('')

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(timer)
  }, [search])

  const resetDialogState = () => {
    setSearch('')
    setDebouncedSearch('')
    setSelectedVehicle(null)
    setSelectedCustomer(null)
    setCustomerMode('existing')
    setActiveTab('existing')
    setNewVehicle({
      vin: '',
      plate: '',
      make: '',
      model: '',
      year: String(new Date().getFullYear()),
    })
    setNewCustomer({
      firstName: '',
      lastName: '',
      email: '',
      phone: '',
    })
    setOdometer('')
    setFuelLevel('50')
    setNotes('')
  }

  const handleDialogOpenChange = (nextOpen: boolean) => {
    if (!nextOpen) {
      resetDialogState()
    }
    onOpenChange(nextOpen)
  }

  const { data: searchData, isLoading } = useWorkshopSearch(debouncedSearch)
  const vehicles = (searchData as WorkshopSearchResponse | undefined)?.data?.vehicles ?? []
  const customers = (searchData as WorkshopSearchResponse | undefined)?.data?.customers ?? []

  const canCreateFromExisting = useMemo(() => {
    return !!selectedVehicle?.customer?.id && Number(odometer) >= 0 && Number(fuelLevel) >= 0
  }, [selectedVehicle, odometer, fuelLevel])

  const canCreateFromNewVehicle = useMemo(() => {
    const vehicleValid =
      newVehicle.vin.trim() &&
      newVehicle.plate.trim() &&
      newVehicle.make.trim() &&
      newVehicle.model.trim() &&
      Number(newVehicle.year) >= 1900
    const intakeValid = Number(odometer) >= 0 && Number(fuelLevel) >= 0

    if (customerMode === 'existing') {
      return vehicleValid && intakeValid && !!selectedCustomer?.id
    }
    return (
      vehicleValid &&
      intakeValid &&
      newCustomer.firstName.trim() &&
      newCustomer.lastName.trim()
    )
  }, [newVehicle, odometer, fuelLevel, customerMode, selectedCustomer, newCustomer])

  async function handleCreateOrder() {
    try {
      if (activeTab === 'existing') {
        if (!selectedVehicle?.customer?.id) {
          toast.error('Select a vehicle linked to a customer.')
          return
        }

      const order = await createOrder.mutateAsync({
        customerId: selectedVehicle.customer.id,
        vehicleId: selectedVehicle.id,
        odometer: Number(odometer),
        fuelLevel: Number(fuelLevel),
        reportedIssue: notes || undefined,
      })

        toast.success('Workshop order created')
        handleDialogOpenChange(false)
        navigate(`/workshop/orders/${order.id}`)
        return
      }

      const registerPayload: RegisterIntakePayload = {
        vin: newVehicle.vin.trim(),
        plate: newVehicle.plate.trim(),
        make: newVehicle.make.trim(),
        model: newVehicle.model.trim(),
        year: Number(newVehicle.year),
      }

      if (customerMode === 'existing') {
        if (!selectedCustomer?.id) {
          toast.error('Select an existing customer.')
          return
        }
        registerPayload.customerId = selectedCustomer.id
      } else {
        registerPayload.firstName = newCustomer.firstName.trim()
        registerPayload.lastName = newCustomer.lastName.trim()
        registerPayload.email = newCustomer.email.trim() || undefined
        registerPayload.phone = newCustomer.phone.trim() || undefined
      }

      const vehicle = await registerIntake.mutateAsync(registerPayload) as ExistingVehicle
      if (!vehicle.customer?.id) {
        toast.error('Vehicle was created but no customer was linked.')
        return
      }

      const order = await createOrder.mutateAsync({
        customerId: vehicle.customer.id,
        vehicleId: vehicle.id,
        odometer: Number(odometer),
        fuelLevel: Number(fuelLevel),
        reportedIssue: notes || undefined,
      })

      toast.success('Workshop order created')
      handleDialogOpenChange(false)
      navigate(`/workshop/orders/${order.id}`)
    } catch {
      toast.error('Failed to create workshop order')
    }
  }

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent className="sm:max-w-4xl">
        <DialogHeader>
          <DialogTitle>Create Workshop Order</DialogTitle>
        </DialogHeader>

        <div className="space-y-4">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as 'existing' | 'new-vehicle')}>
            <TabsList>
              <TabsTrigger value="existing">Search Existing</TabsTrigger>
              <TabsTrigger value="new-vehicle">Create Vehicle</TabsTrigger>
            </TabsList>

            <TabsContent value="existing" className="space-y-4">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder="Search VIN, plate, customer name, phone..."
              />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
                <div className="border rounded-lg">
                  <div className="px-3 py-2 border-b text-sm font-medium">Vehicles</div>
                  <div className="max-h-56 overflow-auto">
                    {isLoading && <div className="p-3 text-sm text-muted-foreground">Searching...</div>}
                    {!isLoading && vehicles.length === 0 && (
                      <div className="p-3 text-sm text-muted-foreground">No vehicles found.</div>
                    )}
                    {vehicles.map((vehicle) => (
                      <button
                        type="button"
                        key={vehicle.id}
                        onClick={() => setSelectedVehicle(vehicle as ExistingVehicle)}
                        className={`w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-accent ${
                          selectedVehicle?.id === vehicle.id ? 'bg-accent' : ''
                        }`}
                      >
                        <div className="text-sm font-medium">
                          {vehicle.year} {vehicle.make} {vehicle.model}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          VIN: {vehicle.vin || 'N/A'} · Plate: {vehicle.plate || 'N/A'}
                        </div>
                        <div className="text-xs text-muted-foreground">
                          Customer: {vehicle.customer ? `${vehicle.customer.first_name} ${vehicle.customer.last_name}` : 'Unassigned'}
                        </div>
                      </button>
                    ))}
                  </div>
                </div>

                <div className="border rounded-lg p-3 space-y-2">
                  <div className="text-sm font-medium">Selected Vehicle</div>
                  {selectedVehicle ? (
                    <>
                      <div className="text-sm">
                        {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
                      </div>
                      <div className="text-xs text-muted-foreground">
                        VIN: {selectedVehicle.vin || 'N/A'} · Plate: {selectedVehicle.plate || 'N/A'}
                      </div>
                      <div className="text-sm">
                        Customer:{' '}
                        {selectedVehicle.customer
                          ? `${selectedVehicle.customer.first_name} ${selectedVehicle.customer.last_name}`
                          : 'No linked customer'}
                      </div>
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">Pick a vehicle from the list.</div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="new-vehicle" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  placeholder="VIN"
                  value={newVehicle.vin}
                  onChange={(e) => setNewVehicle((v) => ({ ...v, vin: e.target.value }))}
                />
                <Input
                  placeholder="Plate"
                  value={newVehicle.plate}
                  onChange={(e) => setNewVehicle((v) => ({ ...v, plate: e.target.value }))}
                />
                <Input
                  placeholder="Make"
                  value={newVehicle.make}
                  onChange={(e) => setNewVehicle((v) => ({ ...v, make: e.target.value }))}
                />
                <Input
                  placeholder="Model"
                  value={newVehicle.model}
                  onChange={(e) => setNewVehicle((v) => ({ ...v, model: e.target.value }))}
                />
                <Input
                  placeholder="Year"
                  type="number"
                  value={newVehicle.year}
                  onChange={(e) => setNewVehicle((v) => ({ ...v, year: e.target.value }))}
                />
              </div>

              <div className="border rounded-lg p-3 space-y-3">
                <div className="text-sm font-medium">Customer</div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={customerMode === 'existing' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCustomerMode('existing')}
                  >
                    Select Existing
                  </Button>
                  <Button
                    type="button"
                    variant={customerMode === 'new' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCustomerMode('new')}
                  >
                    Create New
                  </Button>
                </div>

                {customerMode === 'existing' ? (
                  <div className="space-y-2">
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder="Search customers by name, phone..."
                    />
                    <div className="border rounded-md max-h-44 overflow-auto">
                      {customers.length === 0 && (
                        <div className="p-3 text-sm text-muted-foreground">No customers found.</div>
                      )}
                      {customers.map((customer) => (
                        <button
                          type="button"
                          key={customer.id}
                          onClick={() => setSelectedCustomer(customer as ExistingCustomer)}
                          className={`w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-accent ${
                            selectedCustomer?.id === customer.id ? 'bg-accent' : ''
                          }`}
                        >
                          <div className="text-sm font-medium">
                            {customer.first_name} {customer.last_name}
                          </div>
                          <div className="text-xs text-muted-foreground">
                            {customer.email || 'No email'} · {customer.phone || 'No phone'}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Input
                      placeholder="First Name"
                      value={newCustomer.firstName}
                      onChange={(e) => setNewCustomer((v) => ({ ...v, firstName: e.target.value }))}
                    />
                    <Input
                      placeholder="Last Name"
                      value={newCustomer.lastName}
                      onChange={(e) => setNewCustomer((v) => ({ ...v, lastName: e.target.value }))}
                    />
                    <Input
                      placeholder="Email"
                      type="email"
                      value={newCustomer.email}
                      onChange={(e) => setNewCustomer((v) => ({ ...v, email: e.target.value }))}
                    />
                    <Input
                      placeholder="Phone"
                      value={newCustomer.phone}
                      onChange={(e) => setNewCustomer((v) => ({ ...v, phone: e.target.value }))}
                    />
                  </div>
                )}
              </div>
            </TabsContent>
          </Tabs>

          <div className="border rounded-lg p-3 space-y-3">
            <div className="text-sm font-medium">Order Intake</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                placeholder="Odometer (km)"
                type="number"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
              />
              <Input
                placeholder="Fuel Level (%)"
                type="number"
                value={fuelLevel}
                onChange={(e) => setFuelLevel(e.target.value)}
              />
            </div>
            <textarea
              className="w-full min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder="Issue notes..."
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          <div className="flex justify-end gap-2">
            <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)}>
              Cancel
            </Button>
            <Button
              type="button"
              onClick={handleCreateOrder}
              disabled={
                createOrder.isPending ||
                registerIntake.isPending ||
                (activeTab === 'existing' ? !canCreateFromExisting : !canCreateFromNewVehicle)
              }
            >
              {createOrder.isPending || registerIntake.isPending ? 'Creating...' : 'Create Order'}
            </Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  )
}
