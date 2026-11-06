import type { Customer, Vehicle } from '@/api/types'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import type { TFunction } from 'i18next'
import type { IntakeCustomerMode, NewCustomerForm, NewVehicleForm } from '@/features/workshop/intake-form'

type ExistingVehicle = Vehicle & { customer: Customer | null }
type ExistingCustomer = Customer & { vehicles: Vehicle[] }

type IntakeExistingVehiclePanelProps = {
  t: TFunction<'workshop'>
  search: string
  onSearchChange: (value: string) => void
  isLoading: boolean
  vehicles: Vehicle[]
  selectedVehicle: ExistingVehicle | null
  onSelectVehicle: (vehicle: ExistingVehicle) => void
}

export function IntakeExistingVehiclePanel({
  t,
  search,
  onSearchChange,
  isLoading,
  vehicles,
  selectedVehicle,
  onSelectVehicle,
}: IntakeExistingVehiclePanelProps) {
  return (
    <>
      <Input
        value={search}
        onChange={(event) => onSearchChange(event.target.value)}
        placeholder={t('orderIntake.searchPlaceholder')}
      />
      <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
        <IntakeVehicleList
          t={t}
          isLoading={isLoading}
          vehicles={vehicles}
          selectedVehicleId={selectedVehicle?.id}
          onSelectVehicle={onSelectVehicle}
        />
        <IntakeSelectedVehicle t={t} selectedVehicle={selectedVehicle} />
      </div>
    </>
  )
}

function IntakeVehicleList({
  t,
  isLoading,
  vehicles,
  selectedVehicleId,
  onSelectVehicle,
}: {
  t: TFunction<'workshop'>
  isLoading: boolean
  vehicles: Vehicle[]
  selectedVehicleId?: string
  onSelectVehicle: (vehicle: ExistingVehicle) => void
}) {
  return (
    <div className="border rounded-lg">
      <div className="px-3 py-2 border-b text-sm font-medium">{t('orderIntake.vehicles')}</div>
      <div className="max-h-56 overflow-auto">
        {isLoading && <div className="p-3 text-sm text-muted-foreground">{t('orderIntake.searching')}</div>}
        {!isLoading && vehicles.length === 0 && (
          <div className="p-3 text-sm text-muted-foreground">{t('orderIntake.noVehicles')}</div>
        )}
        {vehicles.map((vehicle) => (
          <button
            type="button"
            key={vehicle.id}
            onClick={() => onSelectVehicle(vehicle as ExistingVehicle)}
            className={`w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-accent ${
              selectedVehicleId === vehicle.id ? 'bg-accent' : ''
            }`}
          >
            <div className="text-sm font-medium">
              {vehicle.year} {vehicle.make} {vehicle.model}
            </div>
            <div className="text-xs text-muted-foreground">
              {t('orderIntake.vehicleMeta', {
                vin: vehicle.vin || t('orderIntake.na'),
                plate: vehicle.plate || t('orderIntake.na'),
              })}
            </div>
            <div className="text-xs text-muted-foreground">
              {t('orderIntake.customerLabel', {
                name: vehicle.customer
                  ? `${vehicle.customer.first_name} ${vehicle.customer.last_name}`
                  : t('orderIntake.unassigned'),
              })}
            </div>
          </button>
        ))}
      </div>
    </div>
  )
}

function IntakeSelectedVehicle({
  t,
  selectedVehicle,
}: {
  t: TFunction<'workshop'>
  selectedVehicle: ExistingVehicle | null
}) {
  if (!selectedVehicle) {
    return (
      <div className="border rounded-lg p-3 space-y-2">
        <div className="text-sm font-medium">{t('orderIntake.selectedVehicle')}</div>
        <div className="text-sm text-muted-foreground">{t('orderIntake.pickVehicle')}</div>
      </div>
    )
  }
  return (
    <div className="border rounded-lg p-3 space-y-2">
      <div className="text-sm font-medium">{t('orderIntake.selectedVehicle')}</div>
      <div className="text-sm">
        {selectedVehicle.year} {selectedVehicle.make} {selectedVehicle.model}
      </div>
      <div className="text-xs text-muted-foreground">
        {t('orderIntake.vehicleMeta', {
          vin: selectedVehicle.vin || t('orderIntake.na'),
          plate: selectedVehicle.plate || t('orderIntake.na'),
        })}
      </div>
      <div className="text-sm">
        {t('orderIntake.customerLabel', {
          name: selectedVehicle.customer
            ? `${selectedVehicle.customer.first_name} ${selectedVehicle.customer.last_name}`
            : t('orderIntake.noLinkedCustomer'),
        })}
      </div>
    </div>
  )
}

type IntakeNewVehiclePanelProps = {
  t: TFunction<'workshop'>
  newVehicle: NewVehicleForm
  onVehicleChange: (vehicle: NewVehicleForm) => void
  customerMode: IntakeCustomerMode
  onCustomerModeChange: (mode: IntakeCustomerMode) => void
  search: string
  onSearchChange: (value: string) => void
  customers: Customer[]
  selectedCustomer: ExistingCustomer | null
  onSelectCustomer: (customer: ExistingCustomer) => void
  newCustomer: NewCustomerForm
  onCustomerChange: (customer: NewCustomerForm) => void
}

export function IntakeNewVehiclePanel(props: IntakeNewVehiclePanelProps) {
  const { t, newVehicle, onVehicleChange } = props
  return (
    <>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <Input placeholder={t('orderIntake.vinPlaceholder')} value={newVehicle.vin} onChange={(event) => onVehicleChange({ ...newVehicle, vin: event.target.value })} />
        <Input placeholder={t('orderIntake.platePlaceholder')} value={newVehicle.plate} onChange={(event) => onVehicleChange({ ...newVehicle, plate: event.target.value })} />
        <Input placeholder={t('orderIntake.makePlaceholder')} value={newVehicle.make} onChange={(event) => onVehicleChange({ ...newVehicle, make: event.target.value })} />
        <Input placeholder={t('orderIntake.modelPlaceholder')} value={newVehicle.model} onChange={(event) => onVehicleChange({ ...newVehicle, model: event.target.value })} />
        <Input placeholder={t('orderIntake.yearPlaceholder')} type="number" value={newVehicle.year} onChange={(event) => onVehicleChange({ ...newVehicle, year: event.target.value })} />
      </div>
      <IntakeCustomerSection {...props} />
    </>
  )
}

function IntakeCustomerSection({
  t,
  customerMode,
  onCustomerModeChange,
  search,
  onSearchChange,
  customers,
  selectedCustomer,
  onSelectCustomer,
  newCustomer,
  onCustomerChange,
}: IntakeNewVehiclePanelProps) {
  return (
    <div className="border rounded-lg p-3 space-y-3">
      <div className="text-sm font-medium">{t('orderIntake.customerSection')}</div>
      <div className="flex gap-2">
        <Button type="button" variant={customerMode === 'existing' ? 'default' : 'outline'} size="sm" onClick={() => onCustomerModeChange('existing')}>
          {t('orderIntake.selectExisting')}
        </Button>
        <Button type="button" variant={customerMode === 'new' ? 'default' : 'outline'} size="sm" onClick={() => onCustomerModeChange('new')}>
          {t('orderIntake.createNew')}
        </Button>
      </div>
      {customerMode === 'existing' ? (
        <IntakeCustomerList
          t={t}
          search={search}
          onSearchChange={onSearchChange}
          customers={customers}
          selectedCustomerId={selectedCustomer?.id}
          onSelectCustomer={onSelectCustomer}
        />
      ) : (
        <IntakeNewCustomerFields t={t} newCustomer={newCustomer} onCustomerChange={onCustomerChange} />
      )}
    </div>
  )
}

function IntakeCustomerList({
  t,
  search,
  onSearchChange,
  customers,
  selectedCustomerId,
  onSelectCustomer,
}: {
  t: TFunction<'workshop'>
  search: string
  onSearchChange: (value: string) => void
  customers: Customer[]
  selectedCustomerId?: string
  onSelectCustomer: (customer: ExistingCustomer) => void
}) {
  return (
    <div className="space-y-2">
      <Input value={search} onChange={(event) => onSearchChange(event.target.value)} placeholder={t('orderIntake.searchCustomersPlaceholder')} />
      <div className="border rounded-md max-h-44 overflow-auto">
        {customers.length === 0 && <div className="p-3 text-sm text-muted-foreground">{t('orderIntake.noCustomers')}</div>}
        {customers.map((customer) => (
          <button
            type="button"
            key={customer.id}
            onClick={() => onSelectCustomer(customer as ExistingCustomer)}
            className={`w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-accent ${selectedCustomerId === customer.id ? 'bg-accent' : ''}`}
          >
            <div className="text-sm font-medium">{customer.first_name} {customer.last_name}</div>
            <div className="text-xs text-muted-foreground">{customer.email || t('orderIntake.noEmail')} · {customer.phone || t('orderIntake.noPhone')}</div>
          </button>
        ))}
      </div>
    </div>
  )
}

function IntakeNewCustomerFields({
  t,
  newCustomer,
  onCustomerChange,
}: {
  t: TFunction<'workshop'>
  newCustomer: NewCustomerForm
  onCustomerChange: (customer: NewCustomerForm) => void
}) {
  return (
    <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
      <Input placeholder={t('orderIntake.firstName')} value={newCustomer.firstName} onChange={(event) => onCustomerChange({ ...newCustomer, firstName: event.target.value })} />
      <Input placeholder={t('orderIntake.lastName')} value={newCustomer.lastName} onChange={(event) => onCustomerChange({ ...newCustomer, lastName: event.target.value })} />
      <Input placeholder={t('orderIntake.email')} type="email" value={newCustomer.email} onChange={(event) => onCustomerChange({ ...newCustomer, email: event.target.value })} />
      <Input placeholder={t('orderIntake.phone')} type="tel" autoComplete="tel" value={newCustomer.phone} onChange={(event) => onCustomerChange({ ...newCustomer, phone: event.target.value })} />
    </div>
  )
}

export function IntakeOrderFields({
  t,
  odometer,
  fuelLevel,
  notes,
  onOdometerChange,
  onFuelLevelChange,
  onNotesChange,
}: {
  t: TFunction<'workshop'>
  odometer: string
  fuelLevel: string
  notes: string
  onOdometerChange: (value: string) => void
  onFuelLevelChange: (value: string) => void
  onNotesChange: (value: string) => void
}) {
  return (
    <div className="border rounded-lg p-3 space-y-3">
      <div className="text-sm font-medium">{t('orderIntake.orderIntakeSection')}</div>
      <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
        <div className="space-y-1.5">
          <Label htmlFor="order-intake-odometer">{t('orderIntake.odometerPlaceholder')}</Label>
          <Input id="order-intake-odometer" placeholder={t('orderIntake.odometerPlaceholder')} type="number" value={odometer} onChange={(event) => onOdometerChange(event.target.value)} />
        </div>
        <div className="space-y-1.5">
          <Label htmlFor="order-intake-fuel">{t('orderIntake.fuelPlaceholder')}</Label>
          <Input id="order-intake-fuel" placeholder={t('orderIntake.fuelPlaceholder')} type="number" value={fuelLevel} onChange={(event) => onFuelLevelChange(event.target.value)} />
        </div>
      </div>
      <textarea
        className="w-full min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-base md:text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
        placeholder={t('orderIntake.notesPlaceholder')}
        value={notes}
        onChange={(event) => onNotesChange(event.target.value)}
      />
    </div>
  )
}
