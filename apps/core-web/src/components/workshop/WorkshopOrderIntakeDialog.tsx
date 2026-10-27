import { useEffect, useRef, useState } from 'react'
import { useTranslation } from 'react-i18next'
import type { Customer, Vehicle, WorkshopSearchResponse } from '@/api/types'
import { useCreateWorkshopOrder, useRegisterIntake, useWorkshopSearch } from '@/api/workshop'
import { useVehicle } from '@/api/vehicles'
import { useNavigate } from 'react-router-dom'
import { toast } from 'sonner'
import { Alert, AlertDescription } from '@/components/ui/alert'
import { Button } from '@/components/ui/button'
import {
  Dialog,
  DialogContent,
  DialogFooter,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from '@/components/ui/dialog'
import { Input } from '@/components/ui/input'
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/components/ui/tabs'
import {
  buildRegisterPayload,
  canSubmitOrder,
  conflictFromError,
  emptyCustomerForm,
  emptyVehicleForm,
  visibleConflict,
} from '@/features/workshop/intake-form'
import type {
  ExistingOrderConflict,
  IntakeCustomerMode,
  IntakeTab,
  NewCustomerForm,
  NewVehicleForm,
} from '@/features/workshop/intake-form'
import { getErrorMessage } from '@/lib/error-utils'
import { APP_ROUTE_PATHS } from '@/lib/app-route-paths'
import { ensureNamespaceLoaded, i18n } from '@/lib/i18n'
import { PageLoader } from '@/components/ui/PageLoader'
import { RegistrationDocumentIntakeStep } from './RegistrationDocumentIntakeStep'

type ExistingVehicle = Vehicle & { customer: Customer | null }
type ExistingCustomer = Customer & { vehicles: Vehicle[] }

interface WorkshopOrderIntakeDialogProps {
  open: boolean
  onOpenChange: (open: boolean) => void
  initialVehicleId?: string
  pickerlMode?: boolean
}

export function WorkshopOrderIntakeDialog({
  open,
  onOpenChange,
  initialVehicleId,
  pickerlMode = false,
}: WorkshopOrderIntakeDialogProps) {
  const { t } = useTranslation('workshop')
  const [workshopNamespaceReady, setWorkshopNamespaceReady] = useState(() =>
    i18n.hasResourceBundle(i18n.language, 'workshop'),
  )
  const navigate = useNavigate()
  const createOrder = useCreateWorkshopOrder()
  const registerIntake = useRegisterIntake()

  const [activeTab, setActiveTab] = useState<IntakeTab>('existing')
  const [search, setSearch] = useState('')
  const [debouncedSearch, setDebouncedSearch] = useState('')
  const [selectedVehicle, setSelectedVehicle] = useState<ExistingVehicle | null>(null)
  const [selectedCustomer, setSelectedCustomer] = useState<ExistingCustomer | null>(null)
  const [customerMode, setCustomerMode] = useState<IntakeCustomerMode>('existing')
  const [newVehicle, setNewVehicle] = useState<NewVehicleForm>(emptyVehicleForm)
  const [newCustomer, setNewCustomer] = useState<NewCustomerForm>(emptyCustomerForm)
  const [odometer, setOdometer] = useState('')
  const [fuelLevel, setFuelLevel] = useState('50')
  const [notes, setNotes] = useState('')
  const [existingOrderConflict, setExistingOrderConflict] = useState<ExistingOrderConflict | null>(
    null,
  )
  // Counts attempts and resets, so a request that finishes after the dialog was reset cannot store its conflict.
  const attemptRef = useRef(0)
  const initialVehicleQuery = useVehicle<ExistingVehicle>(initialVehicleId ?? '')

  useEffect(() => {
    if (!open || workshopNamespaceReady) return
    void ensureNamespaceLoaded('workshop').then(() => setWorkshopNamespaceReady(true))
  }, [open, workshopNamespaceReady])

  useEffect(() => {
    if (!open || !initialVehicleQuery.data) return
    setActiveTab('existing')
    setSelectedVehicle(initialVehicleQuery.data)
    setSearch(initialVehicleQuery.data.plate ?? '')
    setNotes(pickerlMode ? t('orderIntake.pickerlNotesDefault') : '')
  }, [open, initialVehicleQuery.data, pickerlMode, t])

  useEffect(() => {
    const timer = setTimeout(() => setDebouncedSearch(search), 250)
    return () => clearTimeout(timer)
  }, [search])

  const resetDialogState = () => {
    attemptRef.current += 1
    setSearch('')
    setDebouncedSearch('')
    setSelectedVehicle(null)
    setSelectedCustomer(null)
    setCustomerMode('existing')
    setActiveTab('existing')
    setNewVehicle(emptyVehicleForm())
    setNewCustomer(emptyCustomerForm())
    setOdometer('')
    setFuelLevel('50')
    setNotes('')
    setExistingOrderConflict(null)
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

  function openCreatedOrder(orderId: string, message: string) {
    toast.success(message)
    handleDialogOpenChange(false)
    navigate(`/workshop/orders/${orderId}`)
  }

  function handleOpenExistingOrder(orderId: string) {
    handleDialogOpenChange(false)
    navigate(`/workshop/orders/${orderId}`)
  }

  async function handleCreateOrder() {
    setExistingOrderConflict(null)
    attemptRef.current += 1
    const attempt = attemptRef.current
    let orderVehicleId: string | undefined
    try {
      if (activeTab === 'existing') {
        if (!selectedVehicle?.customer?.id) {
          toast.error(t('orderIntake.toastSelectVehicle'))
          return
        }

        orderVehicleId = selectedVehicle.id
        const order = await createOrder.mutateAsync({
          customerId: selectedVehicle.customer.id,
          vehicleId: selectedVehicle.id,
          odometer: Number(odometer),
          fuelLevel: Number(fuelLevel),
          reportedIssue: notes || undefined,
          ...(pickerlMode ? { createPickerlTask: true } : {}),
        })
        openCreatedOrder(
          order.id,
          pickerlMode ? t('orderIntake.toastPickerlOpened') : t('orderIntake.toastOrderCreated'),
        )
        return
      }

      if (customerMode === 'existing' && !selectedCustomer?.id) {
        toast.error(t('orderIntake.toastSelectCustomer'))
        return
      }
      const registerPayload = buildRegisterPayload(newVehicle, newCustomer, customerMode, selectedCustomer?.id)
      const vehicle = (await registerIntake.mutateAsync(registerPayload)) as ExistingVehicle
      if (!vehicle.customer?.id) {
        toast.error(t('orderIntake.toastNoCustomerLinked'))
        return
      }

      orderVehicleId = vehicle.id
      const order = await createOrder.mutateAsync({
        customerId: vehicle.customer.id,
        vehicleId: vehicle.id,
        odometer: Number(odometer),
        fuelLevel: Number(fuelLevel),
        reportedIssue: notes || undefined,
      })
      openCreatedOrder(order.id, t('orderIntake.toastOrderCreated'))
    } catch (error) {
      const conflict = conflictFromError(error, { vehicleId: orderVehicleId, tab: activeTab, formSignature })
      if (conflict && attempt === attemptRef.current) {
        setExistingOrderConflict(conflict)
        return
      }
      toast.error(getErrorMessage(error, t('orderIntake.toastCreateFailed')))
    }
  }

  const formSignature = JSON.stringify([newVehicle, newCustomer, customerMode, selectedCustomer?.id ?? null])
  const activeConflict = visibleConflict(existingOrderConflict, {
    tab: activeTab,
    selectedVehicleId: selectedVehicle?.id,
    formSignature,
  })
  const canSubmit = canSubmitOrder({
    tab: activeTab,
    selectedVehicleCustomerId: selectedVehicle?.customer?.id,
    newVehicle,
    newCustomer,
    customerMode,
    selectedCustomerId: selectedCustomer?.id,
    odometer,
    fuelLevel,
  })

  return (
    <Dialog open={open} onOpenChange={handleDialogOpenChange}>
      <DialogContent fullScreenOnPhone className="flex flex-col overflow-hidden sm:max-w-4xl">
        {open && !workshopNamespaceReady ? (
          <PageLoader />
        ) : (
          <>
        <DialogHeader className="shrink-0">
          <DialogTitle>{t('orderIntake.title')}</DialogTitle>
          <DialogDescription>
            {pickerlMode ? t('orderIntake.descriptionPickerl') : t('orderIntake.description')}
          </DialogDescription>
        </DialogHeader>

        <div className="dialog-body min-h-0 min-w-0 flex-1 space-y-4 overflow-y-auto overflow-x-hidden pr-1">
          <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as IntakeTab)}>
            {!pickerlMode ? (
              <TabsList className="grid h-auto w-full grid-cols-1 sm:inline-flex sm:h-9 sm:w-auto">
                <TabsTrigger value="existing" className="max-sm:min-h-11">
                  {t('orderIntake.tabExisting')}
                </TabsTrigger>
                <TabsTrigger value="new-vehicle" className="max-sm:min-h-11">
                  {t('orderIntake.tabNewVehicle')}
                </TabsTrigger>
                <TabsTrigger value="registration-document" className="max-sm:min-h-11">
                  {t('orderIntake.tabRegistration')}
                </TabsTrigger>
              </TabsList>
            ) : null}

            <TabsContent value="existing" className="space-y-4">
              <Input
                value={search}
                onChange={(e) => setSearch(e.target.value)}
                placeholder={t('orderIntake.searchPlaceholder')}
              />

              <div className="grid grid-cols-1 lg:grid-cols-2 gap-4">
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
                        onClick={() => setSelectedVehicle(vehicle as ExistingVehicle)}
                        className={`w-full text-left px-3 py-2 border-b last:border-b-0 hover:bg-accent ${
                          selectedVehicle?.id === vehicle.id ? 'bg-accent' : ''
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

                <div className="border rounded-lg p-3 space-y-2">
                  <div className="text-sm font-medium">{t('orderIntake.selectedVehicle')}</div>
                  {selectedVehicle ? (
                    <>
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
                    </>
                  ) : (
                    <div className="text-sm text-muted-foreground">{t('orderIntake.pickVehicle')}</div>
                  )}
                </div>
              </div>
            </TabsContent>

            <TabsContent value="new-vehicle" className="space-y-4">
              <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                <Input
                  placeholder={t('orderIntake.vinPlaceholder')}
                  value={newVehicle.vin}
                  onChange={(e) => setNewVehicle((v) => ({ ...v, vin: e.target.value }))}
                />
                <Input
                  placeholder={t('orderIntake.platePlaceholder')}
                  value={newVehicle.plate}
                  onChange={(e) => setNewVehicle((v) => ({ ...v, plate: e.target.value }))}
                />
                <Input
                  placeholder={t('orderIntake.makePlaceholder')}
                  value={newVehicle.make}
                  onChange={(e) => setNewVehicle((v) => ({ ...v, make: e.target.value }))}
                />
                <Input
                  placeholder={t('orderIntake.modelPlaceholder')}
                  value={newVehicle.model}
                  onChange={(e) => setNewVehicle((v) => ({ ...v, model: e.target.value }))}
                />
                <Input
                  placeholder={t('orderIntake.yearPlaceholder')}
                  type="number"
                  value={newVehicle.year}
                  onChange={(e) => setNewVehicle((v) => ({ ...v, year: e.target.value }))}
                />
              </div>

              <div className="border rounded-lg p-3 space-y-3">
                <div className="text-sm font-medium">{t('orderIntake.customerSection')}</div>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={customerMode === 'existing' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCustomerMode('existing')}
                  >
                    {t('orderIntake.selectExisting')}
                  </Button>
                  <Button
                    type="button"
                    variant={customerMode === 'new' ? 'default' : 'outline'}
                    size="sm"
                    onClick={() => setCustomerMode('new')}
                  >
                    {t('orderIntake.createNew')}
                  </Button>
                </div>

                {customerMode === 'existing' ? (
                  <div className="space-y-2">
                    <Input
                      value={search}
                      onChange={(e) => setSearch(e.target.value)}
                      placeholder={t('orderIntake.searchCustomersPlaceholder')}
                    />
                    <div className="border rounded-md max-h-44 overflow-auto">
                      {customers.length === 0 && (
                        <div className="p-3 text-sm text-muted-foreground">{t('orderIntake.noCustomers')}</div>
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
                            {customer.email || t('orderIntake.noEmail')} · {customer.phone || t('orderIntake.noPhone')}
                          </div>
                        </button>
                      ))}
                    </div>
                  </div>
                ) : (
                  <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
                    <Input
                      placeholder={t('orderIntake.firstName')}
                      value={newCustomer.firstName}
                      onChange={(e) => setNewCustomer((v) => ({ ...v, firstName: e.target.value }))}
                    />
                    <Input
                      placeholder={t('orderIntake.lastName')}
                      value={newCustomer.lastName}
                      onChange={(e) => setNewCustomer((v) => ({ ...v, lastName: e.target.value }))}
                    />
                    <Input
                      placeholder={t('orderIntake.email')}
                      type="email"
                      value={newCustomer.email}
                      onChange={(e) => setNewCustomer((v) => ({ ...v, email: e.target.value }))}
                    />
                    <Input
                      placeholder={t('orderIntake.phone')}
                      type="tel"
                      autoComplete="tel"
                      value={newCustomer.phone}
                      onChange={(e) => setNewCustomer((v) => ({ ...v, phone: e.target.value }))}
                    />
                  </div>
                )}
              </div>
            </TabsContent>

            <TabsContent value="registration-document" className="space-y-3">
              <p className="text-sm text-muted-foreground">{t('orderIntake.registrationHint')}</p>
              <RegistrationDocumentIntakeStep
                odometer={odometer}
                fuelLevel={fuelLevel}
                notes={notes}
                onOrderCreated={(orderId) => {
                  handleDialogOpenChange(false)
                  navigate(
                    APP_ROUTE_PATHS.workshopOrderCheckIn.replace(':id', orderId),
                  )
                }}
              />
            </TabsContent>
          </Tabs>

          <div className="border rounded-lg p-3 space-y-3">
            <div className="text-sm font-medium">{t('orderIntake.orderIntakeSection')}</div>
            <div className="grid grid-cols-1 md:grid-cols-2 gap-3">
              <Input
                placeholder={t('orderIntake.odometerPlaceholder')}
                type="number"
                value={odometer}
                onChange={(e) => setOdometer(e.target.value)}
              />
              <Input
                placeholder={t('orderIntake.fuelPlaceholder')}
                type="number"
                value={fuelLevel}
                onChange={(e) => setFuelLevel(e.target.value)}
              />
            </div>
            <textarea
              className="w-full min-h-20 rounded-md border border-input bg-transparent px-3 py-2 text-base md:text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring"
              placeholder={t('orderIntake.notesPlaceholder')}
              value={notes}
              onChange={(e) => setNotes(e.target.value)}
            />
          </div>

          {activeConflict ? (
            <Alert>
              <AlertDescription className="flex flex-wrap items-center justify-between gap-2">
                <span>{activeConflict.message}</span>
                <Button
                  type="button"
                  variant="link"
                  className="h-auto p-0"
                  onClick={() => handleOpenExistingOrder(activeConflict.orderId)}
                >
                  {activeConflict.orderNumber
                    ? t('orderIntake.openOrderNumber', { orderNumber: activeConflict.orderNumber })
                    : t('orderIntake.openExistingOrder')}
                </Button>
              </AlertDescription>
            </Alert>
          ) : null}
        </div>

        <DialogFooter className="shrink-0">
            <Button type="button" variant="outline" onClick={() => handleDialogOpenChange(false)}>
              {t('orderIntake.cancel')}
            </Button>
            <Button
              type="button"
              onClick={handleCreateOrder}
              disabled={
                createOrder.isPending ||
                registerIntake.isPending ||
                !canSubmit ||
                activeTab === 'registration-document'
              }
            >
              {createOrder.isPending || registerIntake.isPending
                ? t('orderIntake.creating')
                : pickerlMode
                  ? t('orderIntake.createPickerl')
                  : t('orderIntake.createOrder')}
            </Button>
        </DialogFooter>
          </>
        )}
      </DialogContent>
    </Dialog>
  )
}
